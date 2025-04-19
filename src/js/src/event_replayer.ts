// Utility class for recording and replaying events, for debugging.

import { AnyJson } from './types';
import { get_timestamp_str } from './util';

export enum ReplayStatus {
    DISABLED = "disabled",
    RECORDING = "recording",
    RUNNING = "running",
}

export type EventCallback = (args: AnyJson) => void;

export type EventCallbackMap = {
    reset: EventCallback;
    mouse: EventCallback;
    clear2: EventCallback;
    clear3: EventCallback;
    tile: (args: AnyJson) => Promise<void>;
};

type EventEntry = {
    rel_time: number;
    event_type: keyof EventCallbackMap;
    args: AnyJson | null;
};

const REPLAY_SPEED = 0.2;

// Currently it only supports replaying for highlight tiles.  Not sure if we'll
// ever support other features ...
export class EventReplayer {
    // For each `event_type` in the record, fn_map[event_type] is a function
    // that takes a single dict as argument, and optionally returns a Promise
    // object that completes the callback.
    constructor(
        private _btns_div: HTMLElement | null,
        private _fn_map: EventCallbackMap
    ) {
        if (_btns_div == null) {
            this._enabled = false;  // We're disabled.
            return;
        }

        this._enabled = true;
        this._status_area = _btns_div.querySelector('span');

        this.reset(ReplayStatus.DISABLED);

        // Hook up buttons for replay.
        let buttons = _btns_div.querySelectorAll('button');
        // Buttons are: record/stop/save/load/replay/clear.
        buttons[0].onclick = () => { this.start_recording(); }
        buttons[1].onclick = () => { this.stop_recording(); }
        buttons[2].onclick = () => { this.save(); }
        buttons[3].onclick = () => { this.load(); }
        buttons[4].onclick = () => { this.start_replay(); }
        buttons[5].onclick = () => { this.clear(); }
    }

    clear(): void {
        if (!this._enabled) return;
        this.reset(ReplayStatus.DISABLED);
        this._fn_map.reset({});
        this._status_area!.textContent = '(Empty)';
    }

    start_recording(): void {
        if (!this._enabled) return;
        this.reset(ReplayStatus.RECORDING);
        this._fn_map.reset({});
        this._status_area!.textContent = 'Recording ...';
    }

    stop_recording(): void {
        if (!this._enabled) return;
        this.status = ReplayStatus.DISABLED;
        this._status_area!.textContent = `Stopped: has ${this._events.length} events.`;
    }

    save(): void {
        if (!this._enabled) return;

        // Stolen from https://stackoverflow.com/a/30832210
        const data = this._event_log.join('\n');
        const contents = new Blob([data], {type: 'text/plain'});
        let a = document.createElement('a');
        let url = URL.createObjectURL(contents);
        a.href = url;
        a.download = 'event_log.txt';
        document.body.appendChild(a);
        a.click();
        window.setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }

    load(): void {
        if (!this._enabled) return;

        // Stolen from https://stackoverflow.com/a/50782106
        let input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';

        let onload = (ev: ProgressEvent): void => {
            let contents = (ev.target as FileReader).result as string;
            document.body.removeChild(input);
            this.load_handler(contents!);
        };

        input.onchange = (_ev: Event) => {
            let file = input.files![0];
            if (file == null) return;
            let reader = new FileReader();
            reader.onload = onload;
            reader.readAsText(file);
        };

        document.body.appendChild(input);
        input.click();
    }

    load_handler(contents: string): void {
        if (!this._enabled) return;

        this._events = [];
        this._event_log = [];
        for (const line of contents.split('\n')) {
            let m = line.match(/[0-9:.]+ +#[0-9]+: *(\[.*\])$/);
            if (m) this._events.push(JSON.parse(m[1]));
        }

        this._status_area!.textContent = `Loaded ${this._events.length} events.`;
    }

    // Record an event: we later call this.fn_map[event_type](args).
    //
    // Currently we support the following events:
    //      'mouse': mouse cursor moves
    //      'leave': mouse leaves the area
    //      'tile': highlight tile received from BE
    record_event(event_type: keyof EventCallbackMap, args: AnyJson): void {
        if (!this._enabled) return;

        if (this.status != ReplayStatus.RUNNING)
            this.rel_time = Date.now() - this._start_T;

        if (this.status != ReplayStatus.RECORDING) return;

        const event_idx = this._events.length;
        const event_entry = {
            rel_time: this.rel_time!,
            event_type: event_type,
            args: args,
        };
        this._events.push(event_entry);
        this._event_log.push(`${get_timestamp_str()} #${event_idx}: ` +
                            JSON.stringify(event_entry));

        this._status_area!.textContent =
            `Recorded ${event_idx + 1} events ...`;
    }

    start_replay(): void {
        if (!this._enabled) return;

        if (this._events.length > 0) {
            this.reset(ReplayStatus.RUNNING);
            this._fn_map.reset({});
            this.replay_event(0);
        }
    }

    replay_event(idx: number): void {
        if (!this._enabled) return;

        if (this.status != ReplayStatus.RUNNING) return;  // Reply disabled.

        const event_entry = this._events[idx];
        this._event_log.push(`${get_timestamp_str()} #${idx}: ` +
                            JSON.stringify(event_entry));
        this.rel_time = event_entry.rel_time;
        const event_type = event_entry.event_type;
        const args = event_entry.args;
        const event_str =
            `event #${idx} of ${this._events.length} : ` +
            `at ${this.rel_time}: ${event_type}(${JSON.stringify(args)})`;
        this._status_area!.textContent = `Replaying ${event_str} ...`;

        (
            this._fn_map[event_type](args || {}) || Promise.resolve(true)
        ).then(() => {
            idx += 1;
            if (idx >= this._events.length) {
                this._status_area!.textContent =
                    `Replay finished for ${this._events.length} events.`;
                return;
            }

            // Instead of starting at a fixed time, let's compute wait time
            // based on the current time - in this way we can set breakpoints in
            // dev tools and continue debugfging.
            let next_rel_T = this._events[idx].rel_time;
            window.setTimeout(
                () => { this.replay_event(idx) },
                (next_rel_T - this.rel_time!) / REPLAY_SPEED
            );

            this._status_area!.textContent = `Executed ${event_str}.`;
        })
        .catch((error: string) => {
            this._status_area!.textContent =
                `Error executing ${event_str}: ${error}`;
            this.status = ReplayStatus.DISABLED;
        });
    }

    // Internal utility function.
    reset(status: ReplayStatus): void {
        if (!this._enabled) return;

        // `rel_time` keeps the "elapsed time" since the start of
        // recording/replay.  During replay, it is actually "fake time" and
        // moves lockstep with the recorded timestamp (so that the replay
        // behavior matches the original execution as much as possible).
        this._start_T = Date.now();
        this.rel_time = 0;

        if (status != ReplayStatus.RUNNING) this._events = [];
        this._event_log = [];
        this.status = status;
    }

    // Add debug logging.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log(...args: any[]): void {
        if (!this._enabled) return;

        if (this.status == ReplayStatus.DISABLED) return;
        const rel_T =
            (this.status == ReplayStatus.RUNNING) ? this.rel_time
                                            : Date.now() - this._start_T;
        const s = args.map(
            e => ((typeof(e) == 'object') ? JSON.stringify(e) : e)
        ).join(' ');
        this._event_log.push(`${get_timestamp_str()}    [${rel_T}] ${s}`);
    }

    private _enabled: boolean = false;
    status: ReplayStatus = ReplayStatus.DISABLED;

    private _status_area: HTMLSpanElement | null = null;
    rel_time: number | null = null;

    private _events: EventEntry[] = [];
    private _event_log: string[] = [];
    private _start_T: number = Date.now();
}
