import { EventEmitter } from 'events';
import * as Url from 'url';

import { CancelledError, InteractiveError, MessageParseError } from '../errors';
import { IRawValues } from '../interfaces';
import { resolveOn } from '../util';
import { Method, Packet, PacketState, Reply } from './packets';
import { ExponentialReconnectionPolicy, IReconnectionPolicy } from './reconnection';

//We don't support lz4 due to time constraints right now
export type CompressionScheme = 'none' | 'gzip';

/**
 * SocketOptions are passed to the Interactive Socket and control behavior.
 */
export interface ISocketOptions {
    // Settings to use for reconnecting automatically to Constellation.
    // Defaults to automatically reconnecting with the ExponentialPolicy.
    reconnectionPolicy?: IReconnectionPolicy;
    autoReconnect?: boolean;

    // Array of possible websocket URLs to connect to.
    urls?: string[];

    //compression scheme, defaults to none, Will remain none until pako typings are updated
    compressionScheme?: CompressionScheme;

    // Query params to add
    queryParams?: IRawValues;

    // Optional OAuth token to use for authentication.
    authToken?: string;

    // Timeout on Constellation method calls before we throw an error.
    replyTimeout?: number;

    // Duration upon which to send a ping to the server. Defaults to 10 seconds.
    pingInterval?: number;
    // Any extra headers to include in the socket connection.
    extraHeaders?: IRawValues;
    // Optional intercept function that can be run before socket reconnections.
    reconnectChecker?: () => Promise<void>;
}

export interface IWebSocketOptions {
    headers: IRawValues;
}

export interface ICloseEvent {
    code: number;
    reason: string;
    wasClean: boolean;
}

/**
 * SocketState is used to record the status of the websocket connection.
 */
export enum SocketState {
    /**
     * A connection attempt has not been made yet.
     */
    Idle = 1,
    /**
     * A connection attempt is currently being made.
     */
    Connecting,
    /**
     * The socket is connection and data may be sent.
     */
    Connected,
    /**
     * The socket is gracefully closing; after this it will become Idle.
     */
    Closing,
    /**
     * The socket is reconnecting after closing unexpectedly.
     */
    Reconnecting,
    /**
     * Connect was called whilst the old socket was still open.
     */
    Refreshing,
}

function getDefaults(): ISocketOptions {
    return {
        urls: [],
        replyTimeout: 10000,
        compressionScheme: 'none',
        autoReconnect: true,
        reconnectionPolicy: new ExponentialReconnectionPolicy(),
        pingInterval: 10 * 1000,
        extraHeaders: {},
        queryParams: {},
        reconnectChecker: () => Promise.resolve(),
    };
}

export class InteractiveSocket extends EventEmitter {
    // WebSocket constructor, may be overridden if the environment
    // does not natively support it.

    //tslint:disable-next-line:variable-name
    public static WebSocket: any = typeof WebSocket === 'undefined' ? null : WebSocket;

    private reconnectTimeout: NodeJS.Timer;
    private options: ISocketOptions;
    private state: SocketState = SocketState.Idle;
    private socket: any;
    private queue: Set<Packet> = new Set<Packet>();
    private lastSequenceNumber = 0;
    private endpointIndex = 0;

    constructor(options: ISocketOptions = {}) {
        super();
        this.setMaxListeners(Infinity);
        this.setOptions(options);

        if (InteractiveSocket.WebSocket === undefined) {
            throw new Error(
                'Cannot find a websocket implementation; please provide one by ' +
                    'running InteractiveSocket.WebSocket = myWebSocketModule;',
            );
        }

        this.on('message', (msg: any) => {
            this.extractMessage(msg);
        });

        this.on('open', () => {
            this.options.reconnectionPolicy.reset();
            this.state = SocketState.Connected;
            this.queue.forEach(data => this.send(data));
        });

        this.on('close', (evt: ICloseEvent) => {
            // If this close event's code is an application error (e.g. bad authentication)
            // or invalid status code (for Edge), we raise it as an error and refuse to
            // reconnect.
            if (evt.code < 1000 || evt.code > 1999 || evt.code === 1005 || evt.code === 4027) {
                const err = InteractiveError.fromSocketMessage({
                    code: evt.code,
                    message: evt.reason,
                });
                this.state = SocketState.Closing;
                this.emit('error', err);
                // Refuse to continue, these errors usually mean something is very wrong with our connection.
                return;
            }

            if (this.state === SocketState.Refreshing) {
                this.state = SocketState.Idle;
                this.options.reconnectChecker().then(() => this.connect());
                return;
            }

            if (this.state === SocketState.Closing || !this.options.autoReconnect) {
                this.state = SocketState.Idle;
                return;
            }

            this.state = SocketState.Reconnecting;

            this.reconnectTimeout = setTimeout(() => {
                this.options.reconnectChecker().then(() => this.connect());
            }, this.options.reconnectionPolicy.next());
        });
    }

    /**
     * Get the options the socket is using.
     */
    public getOptions() {
        return this.options;
    }

    /**
     * Set the given options.
     * Defaults and previous option values will be used if not supplied.
     */
    public setOptions(options: ISocketOptions) {
        this.options = Object.assign({}, this.options || getDefaults(), options);
    }

    /**
     * Open a new socket connection. By default, the socket will auto
     * connect when creating a new instance.
     */
    public connect(): this {
        if (this.state === SocketState.Closing) {
            this.state = SocketState.Refreshing;
            return this;
        }
        const defaultHeaders = {
            'X-Protocol-Version': '2.0',
        };

        const headers = Object.assign({}, defaultHeaders, this.options.extraHeaders);

        const extras: IWebSocketOptions = {
            headers,
        };

        const url = Url.parse(this.getURL(), true);
        // Clear out search so it populates query using the query
        // https://nodejs.org/api/url.html#url_url_format_urlobject
        url.search = null;

        if (this.options.authToken) {
            extras.headers['Authorization'] = `Bearer ${this.options.authToken}`;
        }

        if (typeof WebSocket === 'function' && WebSocket === InteractiveSocket.WebSocket) {
            url.query = Object.assign({}, url.query, this.options.queryParams, extras.headers);
            this.socket = new InteractiveSocket.WebSocket(Url.format(url));
        } else {
            url.query = Object.assign({}, url.query, this.options.queryParams);
            this.socket = new InteractiveSocket.WebSocket(Url.format(url), [], extras);
        }

        this.state = SocketState.Connecting;

        this.socket.addEventListener('close', (evt: ICloseEvent) => this.emit('close', evt));
        this.socket.addEventListener('open', () => this.emit('open'));
        this.socket.addEventListener('message', (evt: any) => this.emit('message', evt.data));

        this.socket.addEventListener('error', (err: any) => {
            if (this.state === SocketState.Closing) {
                // Ignore errors on a closing socket.
                return;
            }

            this.emit('error', err);
        });

        return this;
    }

    /**
     * Returns the current state of the socket.
     * @return {State}
     */
    public getState(): SocketState {
        return this.state;
    }

    /**
     * Close gracefully shuts down the websocket.
     */
    public close() {
        if (this.state === SocketState.Reconnecting) {
            clearTimeout(this.reconnectTimeout);
            this.state = SocketState.Idle;
            return;
        }

        if (this.state !== SocketState.Idle) {
            this.state = SocketState.Closing;
            this.socket.close(1000, 'Closed normally.');
            this.queue.forEach(packet => packet.cancel());
            this.queue.clear();
        }
    }

    /**
     * Executes an RPC method on the server. Returns a promise which resolves
     * after it completes, or after a timeout occurs.
     */
    public execute(
        method: string,
        params: IRawValues = {},
        discard: boolean = false,
    ): Promise<any> {
        const methodObj = new Method(method, params, discard);
        return this.send(new Packet(methodObj));
    }

    /**
     * Send emits a Method over the websocket, wrapped in a Packet to provide queueing and
     * cancellation. It returns a promise which resolves with the reply payload from the Server.
     */
    public send(packet: Packet): Promise<any> {
        if (packet.getState() === PacketState.Cancelled) {
            return Promise.reject(new CancelledError());
        }

        this.queue.add(packet);

        // If the socket has not said hello, queue the request and return
        // the promise eventually emitted when it is sent.
        if (this.state !== SocketState.Connected) {
            return Promise.race([
                resolveOn(packet, 'send'),
                resolveOn(packet, 'cancel').then(() => {
                    throw new CancelledError();
                }),
            ]);
        }

        const timeout = packet.getTimeout(this.options.replyTimeout);
        const promise = Promise.race([
            // Wait for replies to that packet ID:
            resolveOn(this, `reply:${packet.id()}`, timeout)
                .then((result: Reply) => {
                    this.queue.delete(packet);

                    if (result.error) {
                        throw result.error;
                    }

                    return result.result;
                })
                .catch(err => {
                    this.queue.delete(packet);
                    throw err;
                }),
            // Never resolve if the consumer cancels the packets:
            resolveOn(packet, 'cancel', timeout + 1).then(() => {
                throw new CancelledError();
            }),
            // Re-queue packets if the socket closes:
            resolveOn(this, 'close', timeout + 1).then(() => {
                if (!this.queue.has(packet)) {
                    // skip if we already resolved
                    return null;
                }

                packet.setState(PacketState.Pending);
                return this.send(packet);
            }),
        ]);

        packet.emit('send', promise);
        packet.setState(PacketState.Sending);
        this.sendPacketInner(packet);

        return promise;
    }

    public reply(reply: Reply) {
        this.sendRaw(reply);
    }

    private sendPacketInner(packet: Packet) {
        this.sendRaw(packet.setSequenceNumber(this.lastSequenceNumber));
    }

    private sendRaw(packet: any) {
        const data = JSON.stringify(packet);
        const payload = data;

        this.emit('send', payload);
        this.socket.send(payload);
    }

    private getURL(): string {
        const addresses = this.options.urls;
        return this.options.urls[this.endpointIndex++ % addresses.length];
    }

    private extractMessage(packet: string | Buffer) {
        let messageString: string;
        messageString = <string>packet;
        let message: any;
        try {
            message = JSON.parse(messageString);
        } catch (err) {
            throw new MessageParseError('Message returned was not valid JSON');
        }

        if (message.hasOwnProperty('seq')) {
            this.lastSequenceNumber = message.seq;
        }

        switch (message.type) {
            case 'method':
                this.emit('method', Method.fromSocket(message));
                break;
            case 'reply':
                this.emit(`reply:${message.id}`, Reply.fromSocket(message));
                break;
            default:
                throw new MessageParseError(`Unknown message type "${message.type}"`);
        }
    }

    public getQueueSize(): number {
        return this.queue.size;
    }
}
