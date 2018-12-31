import { IParticipant } from '../';
import { IControl, IControlData, IControlUpdate } from './IControl';
import { IButtonKeyboardInput, IButtonMouseInput, IInputEvent } from './IInput';

/**
 * Extends the regular control data with additional properties for Buttons
 */
export interface IButtonData extends IControlData {
    /**
     * The text displayed on the button.
     */
    text?: string;
    /**
     * The tooltip text displayed when the participant hovers over the button.
     */
    tooltip?: string;
    /**
     * The spark cost of this button.
     */
    cost?: number;
    /**
     * The progress bar value of this button. 0 - 1.
     */
    progress?: number;
    /**
     * A unix timestamp of when this button's cooldown will expire.
     */
    cooldown?: number;
    /**
     * A JavaScript keycode which participants can use to activate this button.
     */
    keyCode?: number;
    /**
     * The color of the text.
     */
    textColor?: string;
    /**
     * The size of the text.
     */
    textSize?: string;
    /**
     * The color of the border.
     */
    borderColor?: string;
    /**
     * The background color of the button.
     */
    backgroundColor?: string;
    /**
     * The hover & Focus border color of the button.
     */
    focusColor?: string;
    /**
     * The progress bar & cooldown spinner color for the button.
     */
    accentColor?: string;
}

/**
 * Represents updatable components of a button which developers can update
 * from game clients.
 */
export interface IButtonUpdate extends IControlUpdate {
    /**
     * Will update the text of this button.
     */
    text?: string;
    /**
     * Will update the tooltip of this button.
     */
    tooltip?: string;
    /**
     * In milliseconds, will be converted to a unix timestamp of when this cooldown expires.
     */
    cooldown?: number;
    /**
     * Will update the spark cost of this button.
     */
    cost?: number;
    /**
     * Will update the progress bar underneath the button. 0 - 1.
     */
    progress?: number;
    /**
     * Will update the keycode used by participants for keyboard control.
     */
    keyCode?: number;
        /**
     * The color of the text.
     */
    textColor?: string;
    /**
     * The size of the text.
     */
    textSize?: string;
    /**
     * The color of the border.
     */
    borderColor?: string;
    /**
     * Background color of the button.
     */
    backgroundColor?: string;
    /**
     * Hover & Focus border color of the button.
     */
    focusColor?: string;
    /**
     * Progress bar color for the button.
     */
    accentColor?: string;
}

export interface IButton extends IControl, IButtonData {
    text: string;
    cost: number;
    progress: number;
    cooldown: number;
    keyCode: number;
    textColor: string;
    textSize: string;
    borderColor: string;
    backgroundColor: string;
    focusColor: string;
    accentColor: string;
    // GameClient
    setText(text: string): Promise<void>;
    setProgress(progress: number): Promise<void>;
    setCooldown(duration: number): Promise<void>;
    setCost(cost: number): Promise<void>;
    setTextSize(textSize: string): Promise<void>;
    setBorderColor(borderColor: string): Promise<void>;
    setBackgroundColor(backgroundColor: string): Promise<void>;
    setFocusColor(focusColor: string): Promise<void>;
    setAccentColor(accentColor: string): Promise<void>;
    setTextColor(textColor: string): Promise<void>;
    update(changedData: IButtonUpdate): Promise<void>;

    /**
     * Fired when a participant presses this button with their mouse.
     */
    on(
        event: 'mousedown',
        listener: (inputEvent: IInputEvent<IButtonMouseInput>, participant: IParticipant) => void,
    ): this;
    /**
     * Fired when a participant releases this button with their mouse.
     */
    on(
        event: 'mouseup',
        listener: (inputEvent: IInputEvent<IButtonMouseInput>, participant: IParticipant) => void,
    ): this;
    /**
     * Fired when a participant presses the key associated with this button.
     */
    on(
        event: 'keydown',
        listener: (
            inputEvent: IInputEvent<IButtonKeyboardInput>,
            participant: IParticipant,
        ) => void,
    ): this;
    /**
     * Fired when a participant releases the key associated with this button.
     */
    on(
        event: 'keyup',
        listener: (
            inputEvent: IInputEvent<IButtonKeyboardInput>,
            participant: IParticipant,
        ) => void,
    ): this;
    on(event: string, listener: Function): this;
}
