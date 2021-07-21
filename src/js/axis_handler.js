// The axis handler.

import { INFLIGHT_REQ_EXPIRE_MSEC, sqr } from './util.js';

// Helper class used by AxisHandler.
class AxisTick {
    // `coord`: in pixels.
    constructor(handler, axis, coord, label_str) {
        this.handler = handler;
        this.axis = axis;
        this.coord = coord;

        if (axis == 'x') {
            this.axis_cell = this.handler.x_axis;
            this.css_field = 'left';
        }
        else if (axis == 'y') {
            this.axis_cell = this.handler.y_axis;
            this.css_field = 'top';
        }
        else
            throw 'Should not happen!';

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
        let tile_set = this.handler.tile_handler.tile_set;

        const [offset, limit] =
            (this.axis == 'x') ? [tile_set.x_offset, tile_set.width]
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
}

const REQUEST_NEW_LABELS_DIST_THRESHOLD = 30;

export class AxisHandler {
    constructor(ctxt, tile_handler) {
        this.ctxt = ctxt;
        this.tile_handler = tile_handler;

        this.x_axis = ctxt.canvas_main.querySelector('.cr_x_axis');
        this.y_axis = ctxt.canvas_main.querySelector('.cr_y_axis');
        this.grid = ctxt.canvas_main.querySelector('.cr_grid');

        this.ticks = [];

        this.next_seq = 0;  // Used for `axis_req` message.

        // For flow control, we remember the number of "axis_req" messages we've
        // sent, and don't send more than two messages until we get a response.
        //
        // The logic is similar to TilehHandler.inflight_reqs (but simpler): see
        // there for more discussion.
        //
        // TODO: Refactor into a single helper class?
        this.inflight_reqs = new Map();

        this.last_seq = -1;

        // x/y offsets used for our last "axis_req" message.
        this.last_x_offset = this.last_y_offset = 0;
    }

    // Remove all known ticks and re-create them, following new information sent
    // from the backend.
    // Message type is either 'new_canvas_config' or 'axis_ticks'.
    update(msg_dict) {
        if (msg_dict.msg == 'new_canvas_config') {
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

        for (let axis of ['x', 'y']) {
            for (let [coord, label] of msg_dict.axes[axis])
                this.ticks.push(new AxisTick(this, axis, coord, label));
        }
    }

    // Update ticks based on new location.
    update_location(zoom_udpated) {
        for (let tick of this.ticks) tick.update_location();

        let tile_set = this.tile_handler.tile_set;

        if (!zoom_udpated) {
            // Check if we have drifted far enough to need new labels.
            let dist2 = sqr(tile_set.x_offset - this.last_x_offset) +
                        sqr(tile_set.y_offset - this.last_y_offset);
            if (dist2 < sqr(REQUEST_NEW_LABELS_DIST_THRESHOLD)) return;
        }

        this.tile_handler.replayer.log('Creating new axis_req message ...');

        if (this.inflight_reqs.size >= 2) {
            // TODO: If `zoom_updated` is true, we still need to send the
            //       request!
            this.tile_handler.replayer.log(
                'Too many in-flight axis requests, bailing out ...');
            return;
        }

        const seq = this.next_seq++;
        this.inflight_reqs.set(seq, Date.now());
        const req = {
            config_id: tile_set.config_id,
            zoom_level: tile_set.zoom_level,
            axis_seq: seq,
            x_offset: Math.round(tile_set.x_offset),
            y_offset: Math.round(tile_set.y_offset),
        };

        this.last_x_offset = Math.round(tile_set.x_offset);
        this.last_y_offset = Math.round(tile_set.y_offset);

        this.ctxt.send('axis_req', req);
    }

    // Forget in-flight requests that are too old.
    // TODO: Refactor and merge with TileHandler.expire_old_requests() ?
    expire_old_requests() {
        let deadline = Date.now() - INFLIGHT_REQ_EXPIRE_MSEC;
        for (let [seq_no, timestamp] of this.inflight_reqs) {
            if (timestamp < deadline) {
                this.tile_handler.replayer.log(
                    `Forgetting old seq #${seq_no} ...`);
                this.inflight_reqs.delete(seq_no);
            }
        }
    }

    // Helper function for the crosshair ("nearest point").
    update_crosshair(x, y) {
        if (x == null) {
            for (let hair of
                 this.grid.querySelectorAll('.nearest_x, .nearest_y'))
                hair.remove();
            return;
        }

        let x_hair = document.createElement('div');
        x_hair.classList.add('nearest_x');
        x_hair.style.left = x + 'px';
        this.grid.appendChild(x_hair);

        let y_hair = document.createElement('div');
        y_hair.classList.add('nearest_y');
        y_hair.style.top = y + 'px';
        this.grid.appendChild(y_hair);
    }
}
