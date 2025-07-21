// The axis handler.

import type { EventReplayer } from './event_replayer';
import type { TileHandler} from './tile_handler';
import { Ctxt } from './ctxt';
import { TileSet } from './tile_set';
import { AnyJson } from './types';
import { assertFalse, get_child, INFLIGHT_REQ_EXPIRE_MSEC, sqr } from './util';

enum WhichAxis {
    X = "x",
    Y = "y",
}

// Helper class used by AxisHandler.
class AxisTick {
    // `coord`: in pixels.
    constructor(
        private _handler: AxisHandler,
        public axis: WhichAxis,
        public coord: number,
        label_str: string,
    ) {
        if (axis == WhichAxis.X) {
            this._axis_cell = this._handler.x_axis;
            this._css_field = 'left';
        }
        else if (axis == WhichAxis.Y) {
            this._axis_cell = this._handler.y_axis;
            this._css_field = 'top';
        }
        else
            assertFalse();

        // Add the new tick, label, and grid line.
        this._tick = document.createElement('div');
        this._tick.classList.add('cr_tick');

        this._label = document.createElement('div');
        this._label.classList.add('cr_label');
        this._label.textContent = label_str;

        this._line = document.createElement('div');
        this._line.classList.add(`${axis}_grid`);

        this.update_location();

        this._axis_cell.appendChild(this._tick);
        this._axis_cell.appendChild(this._label);
        this._handler.grid.appendChild(this._line);
    }

    // Acts as a "destructor" - remove myself from display.
    remove(): void {
        this._tick.remove();
        this._label.remove();
        this._line.remove();
    }

    // Update location after panning.
    update_location(): void {
        let tile_set: TileSet = this._handler.tile_handler.tile_set;

        const [offset, limit] =
            (this.axis == WhichAxis.X)
                ? [tile_set.x_offset, tile_set.width]
                : [tile_set.y_offset, tile_set.height];
        const screen_coord = Math.round(offset + this.coord);

        for (let obj of [this._tick, this._label, this._line]) {
            if (screen_coord >= 0 && screen_coord < limit) {
                obj.style[this._css_field] = screen_coord + 'px';
                obj.style.visibility = 'visible';
            }
            else
                obj.style.visibility = 'hidden';
        }
    }

    private _axis_cell: HTMLDivElement;
    private _css_field: "left" | "top";
    private _tick: HTMLDivElement;
    private _label: HTMLDivElement;
    private _line: HTMLDivElement;
}

const REQUEST_NEW_LABELS_DIST_THRESHOLD = 30;

export class AxisHandler {
    constructor(
        private _ctxt: Ctxt,
        public tile_handler: TileHandler,
        private _replayer: EventReplayer,
    ) {
        const root: HTMLElement = _ctxt.root_node;
        this._x_axis = get_child<HTMLDivElement>(root, ".cr_x_axis");
        this._y_axis = get_child<HTMLDivElement>(root, ".cr_y_axis");
        this._grid = get_child<HTMLDivElement>(root, ".cr_grid");
    }

    // Remove all known ticks and re-create them, following new information sent
    // from the backend.
    // Message type is either 'canvas_config' or 'axis_ticks'.
    update(msg_dict: AnyJson): void {
        if (msg_dict.msg == 'canvas_config') {
            // Reset sequence #.
            this._last_seq = -1;
            this._next_seq = 0;
            this._last_x_offset = this._last_y_offset = 0;
        }
        else if (msg_dict.msg == 'axis_ticks') {
            this._inflight_reqs.delete(msg_dict.axis_seq);

            // Check if this is the newest info - otherwise silently ignore.
            if (msg_dict.config_id != this.tile_handler.tile_set.config_id ||
                msg_dict.axis_seq < this._last_seq)
                return;

            this._last_seq = msg_dict.axis_seq;
            this._last_x_offset = msg_dict.x_offset;
            this._last_y_offset = msg_dict.y_offset;
        }

        // Remove all existing ticks.
        for (let tick of this._ticks) tick.remove();
        this._ticks.length = 0;

        for (let axis of [WhichAxis.X, WhichAxis.Y]) {
            for (let [coord, label] of msg_dict.axes[axis])
                this._ticks.push(new AxisTick(this, axis, coord, label));
        }
    }

    // Update ticks based on new location.
    update_location(zoom_udpated: boolean): void {
        for (let tick of this._ticks) tick.update_location();

        let tile_set = this.tile_handler.tile_set;

        if (!zoom_udpated) {
            // Check if we have drifted far enough to need new labels.
            let dist2 = sqr(tile_set.x_offset - this._last_x_offset) +
                        sqr(tile_set.y_offset - this._last_y_offset);
            if (dist2 < sqr(REQUEST_NEW_LABELS_DIST_THRESHOLD)) return;
        }

        this._replayer.log('Creating new axis_req message ...');

        if (this._inflight_reqs.size >= 2) {
            // TODO: If `zoom_updated` is true, we still need to send the
            //       request!
            this._replayer.log(
                'Too many in-flight axis requests, bailing out ...');
            return;
        }

        const seq = this._next_seq++;
        this._inflight_reqs.set(seq, Date.now());
        this._last_x_offset = Math.round(tile_set.x_offset);
        this._last_y_offset = Math.round(tile_set.y_offset);

        this._ctxt.send('axis_req', {
            config: tile_set.current_canvas_config(),
            axis_seq: seq,
        });
    }

    // Forget in-flight requests that are too old.
    // TODO: Refactor and merge with TileHandler.expire_old_requests() ?
    expire_old_requests(): void {
        let deadline = Date.now() - INFLIGHT_REQ_EXPIRE_MSEC;
        for (let [seq_no, timestamp] of this._inflight_reqs) {
            if (timestamp < deadline) {
                this._replayer.log(`Forgetting old seq #${seq_no} ...`);
                this._inflight_reqs.delete(seq_no);
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

    private _ticks: AxisTick[] = [];

    private _next_seq: number = 0;  // Used for `axis_req` message.
    private _last_seq: number = -1;

    // For flow control, we remember the number of "axis_req" messages we've
    // sent, and don't send more than two messages until we get a response.
    //
    // The logic is similar to TilehHandler.inflight_reqs (but simpler): see
    // there for more discussion.
    //
    // TODO: Refactor into a single helper class?
    private _inflight_reqs: Map<number, number> = new Map();

    // x/y offsets used for our last "axis_req" message.
    private _last_x_offset: number = 0;
    private _last_y_offset: number = 0;
}
