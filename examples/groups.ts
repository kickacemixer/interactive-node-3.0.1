/* tslint:disable:no-console */
import * as WebSocket from 'ws';

import {
    GameClient,
    Group,
    IParticipant,
    ISceneDataArray,
    setWebSocket,
} from '../lib';

import { makeControls } from './util';

if (process.argv.length < 4) {
    console.log('Usage gameClient.exe <token> <versionId>');
    console.log(process.argv);
    process.exit();
}

// We need to tell the interactive client what type of websocket we are using.
setWebSocket(WebSocket);

// As we're on the Streamer's side we need a "GameClient" instance
const client = new GameClient();

// Log when we're connected to interactive and setup your game!
client.on('open', () => {
    console.log('Connected to Interactive!');
    // Pull the scenes and groups from the interactive server
    client
        .synchronizeState()

        // Set the client as ready so that interactive controls show up
        .then(() => client.ready(true))

        // Create the scenes for our application
        .then(createScenes)

        // Create the groups for our application
        .then(createGroups)

        // Catch any errors
        .catch((reason: Error) => console.error('Promise rejected', reason));
});

// A collection of interval timers, one for each participant
const participantTimers: Map<string, number> = new Map<string, number>();

// The time between when we switch groups for each participant
const delayTime = 2000;

// These can be un-commented to see the raw JSON messages under the hood
// client.on('message', (err: any) => console.log('<<<', err));
// client.on('send', (err: any) => console.log('>>>', err));
// client.on('error', (err: any) => console.log(err));

/**
 * Swaps the group the current participant is in between secondGroup and default.
 */
function swapParticipantGroup(participant: IParticipant): Promise<void> {
    if (participant.groupID === 'default') {
        participant.groupID = 'secondGroup';
    } else {
        participant.groupID = 'default';
    }

    return client.updateParticipants({
        participants: [participant],
    });
}

/**
 * Removes the participant info from the participantTimers map and stops their timer.
 */
function removeParticipant(participantSessionId: string): void {
    if (participantTimers.has(participantSessionId)) {
        clearInterval(participantTimers[participantSessionId]);
        delete participantTimers[participantSessionId];
    }
}

/**
 * Create the scenes used by the application.
 */
function createScenes(): Promise<ISceneDataArray> {
    const defaultScene = client.state.getScene('default');
    defaultScene.createControls(makeControls(1, () => 'Scene: default'));

    const secondScene = {
        sceneID: 'secondScene',
        controls: makeControls(1, () => 'Scene: second'),
    };

    return client.createScenes({
        scenes: [secondScene],
    });
}

/**
 * Create and setup the groups used by the application.
 */
function createGroups(): Promise<void> {
    const defaultGroup = client.state.getGroup('default');
    defaultGroup.sceneID = 'default';

    const secondGroup = new Group({
        groupID: 'secondGroup',
        sceneID: 'secondScene',
    });

    const thirdGroup = new Group({
        groupID: 'thirdGroup',
        sceneID: 'default',
    });

    return (
        client
            // First update the default group
            .updateGroups({
                groups: [defaultGroup],
            })

            // Then create the new groups
            .then(() =>
                client.createGroups({
                    groups: [secondGroup, thirdGroup],
                }),
            )

            // Then delete the third group
            .then(() =>
                client.deleteGroup({
                    groupID: thirdGroup.groupID,
                    reassignGroupID: defaultGroup.groupID,
                }),
            )
    );
}

// Now we open the connection passing in our authentication details and an experienceId.
client
    // Open the Mixer interactive client with command line args
    .open({
        authToken: process.argv[2],
        versionId: parseInt(process.argv[3], 10),
    })

    // Catch any errors
    .catch((reason: Error) => console.error('Promise rejected', reason));

client.state.on('participantJoin', (participant: IParticipant) => {
    console.log(`${participant.username}(${participant.sessionID}) Joined`);

    if (!participantTimers.has(participant.sessionID)) {
        participantTimers[participant.sessionID] = setInterval(() => {
            const p = client.state.getParticipantBySessionID(
                participant.sessionID,
            );

            if (p) {
                swapParticipantGroup(p);
            } else {
                removeParticipant(participant.sessionID);
            }
        }, delayTime);
    }
});

client.state.on(
    'participantLeave',
    (participantSessionID: string, participant: IParticipant) => {
        console.log(`${participant.username}(${participantSessionID}) Left`);
        removeParticipant(participantSessionID);
    },
);
/* tslint:enable:no-console */
