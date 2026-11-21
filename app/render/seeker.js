// Seeking a player that may be slow to seek, without ever falling behind.
//
// Dragging through a moment asks for a new position on every movement of the
// thumb — dozens a second. Setting a player's position while it is still
// finding the last one makes it start over, so on a phone that seeks slowly
// (Android's recordings carry no index to seek by) nothing is shown until the
// thumb stops. Here there is at most one seek in flight; whatever is asked for
// meanwhile replaces whatever was waiting, and goes as soon as the player is
// free. The picture moves in steps on a slow phone, but it always moves, and it
// ends exactly where the thumb did.
export class Seeker {
    seek;
    /** Where the player is going, or null when it is not seeking. */
    #going = null;
    /** The newest position asked for while it was busy; null when none is waiting. */
    #waiting = null;
    /** Where it last arrived. */
    #at = null;
    /** `seek` sets the player going to a position, in ms; `seeked` is called when it gets there. */
    constructor(seek) {
        this.seek = seek;
    }
    /** Go to `ms` — now if the player is free, or as soon as it is. */
    request(ms) {
        if (this.#going !== null) {
            this.#waiting = ms;
            return;
        }
        if (ms === this.#at)
            return;
        this.#go(ms);
    }
    /** The player has arrived. Off to the newest position asked for since, if any. */
    seeked() {
        if (this.#going === null)
            return;
        this.#at = this.#going;
        this.#going = null;
        const next = this.#waiting;
        this.#waiting = null;
        if (next !== null && next !== this.#at)
            this.#go(next);
    }
    /** The player was given something else to show: any seek in flight will not report back. */
    reset() {
        this.#going = null;
        this.#waiting = null;
        this.#at = null;
    }
    #go(ms) {
        this.#going = ms;
        this.seek(ms);
    }
}
//# sourceMappingURL=seeker.js.map