// Utility class for recording and replaying events, for debugging.

import { AnyJson } from './types';
import { get_timestamp_str } from './util';

export enum ReplayStatus {
    DISABLED = "disabled",
    RECORDING = "recording",
    RUNNING = "running",
}

const REPLAY_SPEED = 0.2;

// Currently it only supports replaying for highlight tiles.  Not sure if we'll
// ever support other features ...
export class EventReplayer {
    // For each `event_type` in the record, fn_map[event_type] is a function
    // that takes a single dict as argument, and optionally returns a Promise
    // object that completes the callback.
    constructor(btns_div: HTMLElement | null, fn_map) {
        this.btns_div = btns_div;
        if (btns_div == null) {
            this.enabled = false;  // We're disabled.
            return;
        }

        this.enabled = true;
        this.status_area = btns_div.querySelector('span');
        this.fn_map = fn_map;

        this.reset(ReplayStatus.DISABLED);

        // Hook up buttons for replay.
        let buttons = btns_div.querySelectorAll('button');
        // Buttons are: record/stop/save/load/replay/clear.
        buttons[0].onclick = () => { this.start_recording(); }
        buttons[1].onclick = () => { this.stop_recording(); }
        buttons[2].onclick = () => { this.save(); }
        buttons[3].onclick = () => { this.load(); }
        buttons[4].onclick = () => { this.start_replay(); }
        buttons[5].onclick = () => { this.clear(); }
    }

    clear() {
        if (!this.enabled) return;
        this.reset(ReplayStatus.DISABLED);
        this.run_cb('reset', {}).then();
        this.status_area.textContent = '(Empty)';
    }

    start_recording() {
        if (!this.enabled) return;
        this.reset(ReplayStatus.RECORDING);
        this.run_cb('reset', {}).then();
        this.status_area.textContent = 'Recording ...';
    }

    stop_recording() {
        if (!this.enabled) return;
        this.status = ReplayStatus.DISABLED;
        this.status_area.textContent = `Stopped: has ${this.events.length} events.`;
    }

    save() {
        if (!this.enabled) return;

        // Stolen from https://stackoverflow.com/a/30832210
        const data = this.event_log.join('\n');
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

    load() {
        if (!this.enabled) return;

        // Stolen from https://stackoverflow.com/a/50782106
        let input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';

        let onload = (ev) => {
            let contents = ev.target.result;
            document.body.removeChild(input);
            this.load_handler(contents);
        };

        input.onchange = (ev) => {
            let file = ev.target.files[0];
            if (file == null) return;
            let reader = new FileReader();
            reader.onload = onload;
            reader.readAsText(file);
        };

        document.body.appendChild(input);
        input.click();
    }

    load_handler(contents) {
        if (!this.enabled) return;

        this.events = [];
        this.event_log = [];
        for (const line of contents.split('\n')) {
            let m = line.match(/[0-9:.]+ +#[0-9]+: *(\[.*\])$/);
            if (m) this.events.push(JSON.parse(m[1]));
        }

        this.status_area.textContent = `Loaded ${this.events.length} events.`;
    }

    // Record an event: we later call this.fn_map[event_type](args).
    //
    // Currently we support the following events:
    //      'mouse': mouse cursor moves
    //      'leave': mouse leaves the area
    //      'tile': highlight tile received from BE
    record_event(event_type: string, args: AnyJson) {
        if (!this.enabled) return;

        if (this.status != ReplayStatus.RUNNING)
            this.rel_time = Date.now() - this.start_T;

        if (this.status != ReplayStatus.RECORDING) return;

        const event_idx = this.events.length;
        const event_entry = [this.rel_time, event_type, args];
        this.events.push(event_entry);
        this.event_log.push(`${get_timestamp_str()} #${event_idx}: ` +
                            JSON.stringify(event_entry));

        this.status_area.textContent =
            `Recorded ${event_idx + 1} events ...`;
    }

    start_replay() {
        if (!this.enabled) return;

        if (this.events.length > 0) {
            this.reset(ReplayStatus.RUNNING);
            this.run_cb('reset', {}).then();
            this.replay_event(0);
        }
    }

    replay_event(idx) {
        if (!this.enabled) return;

        if (this.status != ReplayStatus.RUNNING) return;  // Reply disabled.

        const event_entry = this.events[idx];
        this.event_log.push(`${get_timestamp_str()} #${idx}: ` +
                            JSON.stringify(event_entry));
        let event_type, args;
        [this.rel_time, event_type, args] = this.events[idx];
        const event_str =
            `event #${idx} of ${this.events.length} : ` +
            `at ${this.rel_time}: ${event_type}(${JSON.stringify(args)})`;
        this.status_area.textContent = `Replaying ${event_str} ...`;
        this.run_cb(event_type, args).then(() => {
            idx += 1;
            if (idx >= this.events.length) {
                this.status_area.textContent =
                    `Replay finished for ${this.events.length} events.`;
                return;
            }

            // Instead of starting at a fixed time, let's compute wait time
            // based on the current time - in this way we can set breakpoints in
            // dev tools and continue debugfging.
            let next_rel_T = this.events[idx][0];
            window.setTimeout(() => { this.replay_event(idx) },
                       (next_rel_T - this.rel_time) / REPLAY_SPEED);

            this.status_area.textContent = `Executed ${event_str}.`;
        })
        .catch(error => {
            this.status_area.textContent =
                `Error executing ${event_str}: ${error}`;
            this.status = ReplayStatus.DISABLED;
        });
    }

    // Internal utility function.
    reset(status) {
        if (!this.enabled) return;

        // `rel_time` keeps the "elapsed time" since the start of
        // recording/replay.  During replay, it is actually "fake time" and
        // moves lockstep with the recorded timestamp (so that the replay
        // behavior matches the original execution as much as possible).
        this.start_T = Date.now();
        this.rel_time = 0;

        if (status != ReplayStatus.RUNNING) this.events = [];
        this.event_log = [];
        this.status = status;
    }

    run_cb(event_type, args) {
        if (!this.enabled) return;

        let retval = this.fn_map[event_type](args);
        return retval || Promise.resolve(true /* unused */);
    }

    // Add debug logging.
    log(...args) {
        if (!this.enabled) return;

        if (this.status == ReplayStatus.DISABLED) return;
        const rel_T =
            (this.status == ReplayStatus.RUNNING) ? this.rel_time
                                            : Date.now() - this.start_T;
        const s = args.map(
            e => ((typeof(e) == 'object') ? JSON.stringify(e) : e)
        ).join(' ');
        this.event_log.push(`${get_timestamp_str()}    [${rel_T}] ${s}`);
    }

    private enabled: boolean = false;
    private btns_div: HTMLElement | null;
    status: ReplayStatus = ReplayStatus.DISABLED;

    private status_area: SpanElement;
    private fn_map: any;  // XXX
    rel_time: number | null = null;
}
