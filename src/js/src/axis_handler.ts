// The axis handler.

import type { EventReplayer } from './event_replayer';
import type { TileHandler} from './tile_handler';
import { Ctxt } from './ctxt';
import { TileSet } from './tile_set';
import { AnyJson } from './types';
import { assertFalse, INFLIGHT_REQ_EXPIRE_MSEC, sqr } from './util';

enum WhichAxis {
    X = "x",
    Y = "y",
}

// Helper class used by AxisHandler.
class AxisTick {
    // `coord`: in pixels.
    constructor(
        private handler: AxisHandler,
        public axis: WhichAxis,
        public coord: number,
        label_str: string,
    ) {
        if (axis == WhichAxis.X) {
            this.axis_cell = this.handler.x_axis;
            this.css_field = 'left';
        }
        else if (axis == WhichAxis.Y) {
            this.axis_cell = this.handler.y_axis;
            this.css_field = 'top';
        }
        else
            assertFalse();

        // Add the new tick, label, and grid line.
        this.tick = document.createElement('div');
        this.tick.classList.add('cr_tick');

        this.label = document.createElement('div');
        this.label.classList.add('cr_label');
        this.label.textContent = label_str;

        this.line = document.createElement('div');
        this.line.classList.add(`${axis}_grid`);

        this.update_location();

        this.axis_cell.appendChild(this.tick);
        this.axis_cell.appendChild(this.label);
        this.handler.grid.appendChild(this.line);
    }

    // Acts as a "destructor" - remove myself from display.
    remove() {
        this.tick.remove();
        this.label.remove();
        this.line.remove();
    }

    // Update location after panning.
    update_location() {
        let tile_set: TileSet = this.handler.tile_handler.tile_set;

        const [offset, limit] =
            (this.axis == WhichAxis.X)
                ? [tile_set.x_offset, tile_set.width]
                : [tile_set.y_offset, tile_set.height];
        const screen_coord = Math.round(offset + this.coord);

        for (let obj of [this.tick, this.label, this.line]) {
            if (screen_coord >= 0 && screen_coord < limit) {
                obj.style[this.css_field] = screen_coord + 'px';
                obj.style.visibility = 'visible';
            }
            else
                obj.style.visibility = 'hidden';
        }
    }

    private axis_cell: HTMLDivElement;
    private css_field: "left" | "top";
    private tick: HTMLDivElement;
    private label: HTMLDivElement;
    private line: HTMLDivElement;
}

const REQUEST_NEW_LABELS_DIST_THRESHOLD = 30;

export class AxisHandler {
    constructor(
        private ctxt: Ctxt,
        public tile_handler: TileHandler,
        private _replayer: EventReplayer,
        cr_main1_elem: HTMLElement,
    ) {
        this._x_axis = cr_main1_elem.querySelector('.cr_x_axis')! as HTMLDivElement;
        this._y_axis = cr_main1_elem.querySelector('.cr_y_axis')! as HTMLDivElement;
        this._grid = cr_main1_elem.querySelector('.cr_grid')! as HTMLDivElement;
    }

    // Remove all known ticks and re-create them, following new information sent
    // from the backend.
    // Message type is either 'canvas_config' or 'axis_ticks'.
    update(msg_dict: AnyJson) {
        if (msg_dict.msg == 'canvas_config') {
            // Reset sequence #.
            this.last_seq = -1;
            this.next_seq = 0;
            this.last_x_offset = this.last_y_offset = 0;
        }
        else if (msg_dict.msg == 'axis_ticks') {
            this.inflight_reqs.delete(msg_dict.axis_seq);

            // Check if this is the newest info - otherwise silently ignore.
            if (msg_dict.config_id != this.tile_handler.tile_set.config_id ||
                msg_dict.axis_seq < this.last_seq)
                return;

            this.last_seq = msg_dict.axis_seq;
            this.last_x_offset = msg_dict.x_offset;
            this.last_y_offset = msg_dict.y_offset;
        }

        // Remove all existing ticks.
        for (let tick of this.ticks) tick.remove();
        this.ticks.length = 0;

        for (let axis of [WhichAxis.X, WhichAxis.Y]) {
            for (let [coord, label] of msg_dict.axes[axis])
                this.ticks.push(new AxisTick(this, axis, coord, label));
        }
    }

    // Update ticks based on new location.
    update_location(zoom_udpated: boolean) {
        for (let tick of this.ticks) tick.update_location();

        let tile_set = this.tile_handler.tile_set;

        if (!zoom_udpated) {
            // Check if we have drifted far enough to need new labels.
            let dist2 = sqr(tile_set.x_offset - this.last_x_offset) +
                        sqr(tile_set.y_offset - this.last_y_offset);
            if (dist2 < sqr(REQUEST_NEW_LABELS_DIST_THRESHOLD)) return;
        }

        this._replayer.log('Creating new axis_req message ...');

        if (this.inflight_reqs.size >= 2) {
            // TODO: If `zoom_updated` is true, we still need to send the
            //       request!
            this._replayer.log(
                'Too many in-flight axis requests, bailing out ...');
            return;
        }

        const seq = this.next_seq++;
        this.inflight_reqs.set(seq, Date.now());
        this.last_x_offset = Math.round(tile_set.x_offset);
        this.last_y_offset = Math.round(tile_set.y_offset);

        this.ctxt.send('axis_req', {
            config: tile_set.current_canvas_config(),
            axis_seq: seq,
        });
    }

    // Forget in-flight requests that are too old.
    // TODO: Refactor and merge with TileHandler.expire_old_requests() ?
    expire_old_requests() {
        let deadline = Date.now() - INFLIGHT_REQ_EXPIRE_MSEC;
        for (let [seq_no, timestamp] of this.inflight_reqs) {
            if (timestamp < deadline) {
                this._replayer.log(`Forgetting old seq #${seq_no} ...`);
                this.inflight_reqs.delete(seq_no);
            }
        }
    }

    // Helper function for the crosshair ("nearest point").
    update_crosshair(x: number | null, y: number | null): void {
        if (x == null) {
            for (let hair of
                 this._grid.querySelectorAll('.nearest_x, .nearest_y'))
                hair.remove();
            return;
        }

        let x_hair = document.createElement('div');
        x_hair.classList.add('nearest_x');
        x_hair.style.left = x + 'px';
        this._grid.appendChild(x_hair);

        let y_hair = document.createElement('div');
        y_hair.classList.add('nearest_y');
        y_hair.style.top = y + 'px';
        this._grid.appendChild(y_hair);
    }

    private _x_axis: HTMLDivElement;
    private _y_axis: HTMLDivElement;
    private _grid: HTMLDivElement;

    get x_axis(): HTMLDivElement { return this._x_axis; }
    get y_axis(): HTMLDivElement { return this._y_axis; }
    get grid(): HTMLDivElement { return this._grid; }

    private ticks: AxisTick[] = [];

    private next_seq: number = 0;  // Used for `axis_req` message.
    private last_seq: number = -1;

    // For flow control, we remember the number of "axis_req" messages we've
    // sent, and don't send more than two messages until we get a response.
    //
    // The logic is similar to TilehHandler.inflight_reqs (but simpler): see
    // there for more discussion.
    //
    // TODO: Refactor into a single helper class?
    private inflight_reqs: Map<number, number> = new Map();

    // x/y offsets used for our last "axis_req" message.
    private last_x_offset = 0;
    private last_y_offset = 0;
}
