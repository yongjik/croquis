// The main handler for canvas and tiles.

import { AxisHandler } from './axis_handler.js';
import { CanvasMouseHandler } from './canvas_mouse_handler.js';
import { EventReplayer, REPLAY_RUNNING } from './event_replayer.js';
import { Label } from './label.js';
import { TileSet } from './tile_set.js';
import {
    hide,
    INFLIGHT_REQ_EXPIRE_MSEC,
    ITEM_ID_SENTINEL,
    LRUCache,
    PopupBox,
    PROGRESSBAR_TIMEOUT,
    sqr,
    unhide,
    ZOOM_FACTOR,
} from './util.js';

// TODO: The highlight algorithm is too complicated: we can probably remove some
//       part without issues.
const HISTORY_MIN_STEP_MSEC = 5.0;
const HISTORY_WINDOW_MSEC = 150.0;
const PREDICT_STEP_MSEC = 20.0;

const PREDICT_ERROR_THRESHOLD = 5.0;  // pixels
const HISTORY_RESET_THRESHOLD = 50.0;  // pixels

const MAX_DISTANCE = 30.0;  // pixels
const MAX_PREDICTION_LINE_STEP = 10.0;  // pixels
const EXHAUSTIVE_SEARCH_RADIUS = 5;  // pixels
const MAX_COLORS_PER_PREDICT_STEP = 5;
const MAX_WAYPOINT_CNT = 50;

const MIN_HIGHLIGHT_DURATION_MSEC = 100.0;
const MIN_FG_VISIBLE_MSEC = 500.0;

const MAX_INFLIGHT_REQUESTS = 50;

const TOOLTIP_OFFSET_X = 25;  // pixels
const TOOLTIP_OFFSET_Y = 10;  // pixels

// Draw the "comet" showing mouse event positions, for debugging.
// WARNING: takes a lot of resource - should be off when debugging performance!
const SHOW_WAYPOINT_COMET = false;

const HIGHLIGHT_VIA_CANVAS = 'canvas';
const HIGHLIGHT_VIA_SEARCH = 'search';

// Coordinates of nearest points to show inside the tooltip.
//
// This "cache" is intentially small because we are going to request the nearest
// point every time the mouse stopped anyway.
class NearestPts {
    constructor() {
        this.cache = new LRUCache(10, () => true);
    }

    // config_id/zoom_level/x_offset/y_offset: describes the
    // current canvas configuration.
    //
    // mouse_x, mouse_y: the current mouse cursor position (relative to the top
    // left corner of the canvas)
    //
    // item_id: duh
    //
    // pt_x, pt_y: the nearest point (data coordinate)
    //
    // Everything except for pt_x/pt_y is part of the key - we need so much
    // information because the "nearest point" depends on what's currently
    // visible on the canvas.
    insert(msg_dict) {
        const keys = ['config_id', 'zoom_level', 'x_offset', 'y_offset',
                      'mouse_x', 'mouse_y', 'item_id'];
        const key = keys.map((k) => msg_dict[k]).join(':');
        const data = {
            data_x: msg_dict.data_x,
            data_y: msg_dict.data_y,
            screen_x: msg_dict.screen_x,
            screen_y: msg_dict.screen_y,
        };
        this.cache.insert(key, data);
    }

    get(config_id, zoom_level, x_offset, y_offset, mouse_x, mouse_y, item_id) {
        const key = [
            config_id, zoom_level, x_offset, y_offset, mouse_x, mouse_y, item_id
        ].map(Math.round).join(':');
        return this.cache.get(key);
    }
}

export class TileHandler {
    constructor(ctxt) {
        // Used when replaying tile events, to keep context.
        this.tile_replay_cb = null;
        this.tile_replay_buf = [];

        // Initialize replay handler for debugging.
        let btns_div = document.querySelector(`#${ctxt.canvas_id}-btns`);
        this.replayer = new EventReplayer(btns_div, {
            reset: () => {
                this.tile_set.set_highlight(null, null);
                this.tile_set.tile_cache.clear();
                this.reset_state();
            },

            // TODO!
            // register_canvas_config: (args) => { what here? }

            mouse: (args) => this.mouse_handler.replay_mouse_event(args),
            clear2: () => this.clear_highlight2(),
            clear3: () => this.clear_highlight3(),

            tile: (args) => {
                return new Promise((resolve, reject) => {
                    this.tile_replay_handler(resolve, args.keys, 0);
                });
            },
        });

        // Shorthand.
        let qs = (selector) => ctxt.canvas_main.querySelector(selector);

        this.ctxt = ctxt;
        this.tile_set = new TileSet(ctxt);
        this.canvas = ctxt.canvas;
        this.axis_handler = new AxisHandler(ctxt, this);
        this.fg = this.canvas.querySelector('.cr_foreground');

        this.mouse_handler =
            new CanvasMouseHandler(this, this.replayer, this.canvas);
        this.tooltip = qs('.cr_tooltip');
        this.nearest_pts = new NearestPts();

        // TODO: Support replay?
        this.searchbox = qs('.cr_searchbox input');
        this.searchbox.addEventListener(
            'input', (ev) => this.search_handler(ev));

        this.search_result_area = qs('.cr_search_result');
        // Keeps track of labels in the search result area.
        this.labels = [new Label(ITEM_ID_SENTINEL, false, null, null, null)];
        this.label_map = new Map();
        this.highlighted_label = null;

        qs('.cr_home_btn').addEventListener('click', (ev) => {
            this.ctxt.send('resize', {w: this.ctxt.width, h: this.ctxt.height});
        });
        qs('.cr_zoom_in_btn').addEventListener('click', (ev) => {
            this.tile_set.zoom_level++;
            this.tile_set.x_offset *= ZOOM_FACTOR;
            this.tile_set.y_offset *= ZOOM_FACTOR;
            this.tile_set.refresh();
            this.axis_handler.update_location(true);
            this.request_new_tiles();
        });
        qs('.cr_zoom_out_btn').addEventListener('click', (ev) => {
            this.tile_set.zoom_level--;
            this.tile_set.x_offset /= ZOOM_FACTOR;
            this.tile_set.y_offset /= ZOOM_FACTOR;
            this.tile_set.refresh();
            this.axis_handler.update_location(true);
            this.request_new_tiles();
        });

        (this.btn_regex = qs('.cr_regex')).addEventListener(
            'change', (ev) => this.search_handler(ev));
        (this.btn_autoselect = qs('.cr_autoselect')).addEventListener(
            'change', (ev) => this.autoselect_handler(ev));

        this.btn_popup = new PopupBox(qs('.cr_btn_popup'));

        qs('.cr_more').addEventListener('click', (ev) => {
            if (this.searchbox.value != '') {
                this.btn_select_matching.textContent =
                    'Select all matching ' + this.searchbox.value;
                unhide(this.btn_select_matching.parentNode);
                this.btn_deselect_matching.textContent =
                    'Deselect all matching ' + this.searchbox.value;
                unhide(this.btn_deselect_matching.parentNode);
            }
            else {
                hide(this.btn_select_matching.parentNode);
                hide(this.btn_deselect_matching.parentNode);
            }

            this.btn_popup.show();
        });

        (this.btn_select_all = qs('.cr_select_all')).addEventListener(
            'click', (ev) => this.select_btn_handler(ev, 'select_all'));
        (this.btn_deselect_all = qs('.cr_deselect_all')).addEventListener(
            'click', (ev) => this.select_btn_handler(ev, 'deselect_all'));
        (this.btn_select_matching = qs('.cr_select_matching')).addEventListener(
            'click', (ev) => this.select_btn_handler(ev, 'select_matching'));
        (this.btn_deselect_matching = qs('.cr_deselect_matching')).addEventListener(
            'click', (ev) => this.select_btn_handler(ev, 'deselect_matching'));

        this.search_stat_area = qs('.cr_search_stat');

        // Set to true if we couldn't send request to udpate tiles after
        // selection change, because there were too many in-flight tiles.
        this.tile_update_stalled = false;

        this.reset_state();

        // Implements a rudimentary flow control, because apparently javascript
        // is still much slower than BE --- so if we just send as many requests
        // as possible then we can get overwhelmed by responses!
        //
        // So, we keep the list of requests until we get corresponding requests,
        // and stop sending more requests if it goes over limit.
        //
        // Each tile request contains a unique increasing (sequence #).  Each
        // tile response from BE indicates the sequence numbers that are no
        // longer "in-flight": normally it will be the sequence number of the
        // original request for the tile, but in case BE receives duplicate
        // requests, it can just attach these "orphaned" seqnce numbers to the
        // next outgoing response, because in the end what's important is the
        // count of requests in flight.
        //
        // In-flight requests that are super-old are silently discarded, just in
        // case we have network issues or something similar.  (Not sure if we
        // need this...)
        //
        // Key is (sequence #), value is timestamp.
        //
        // TODO: Also implement deduplication on FE?  It doesn't make much sense
        //       to send duplicate tile requests so that BE can ignore it ...
        this.next_seq = 0;
        this.inflight_reqs = new Map();

        // Sequence numbers of responses to acknowledge: piggybacks on the next
        // request.
        this.ack_seqs = [];

        // Tiles that are received but not processed yet.
        //
        // Apparently, processing each tile one by one can hog the CPU, until
        // tiles are queued up for multiple seconds(!!) before processing.  This
        // is clearly unacceptable.  So, we enqueue received tiles here so that
        // multiple tiles can be processed at once.
        this.received_tiles = [];
    }

    // Utility function for initializing/resetting internal state.
    // (Used for replaying.)
    reset_state() {
        this.update_T = null;  // Last time highlight was changed.
        this.hide_cb = null;  // Set if we want to hide the foreground.
        this.highlight_change_time = null;
            // Last time the highlighted item was changed.

        // Remember recent coordinates of mouse movement for predictive
        // highlighting.
        this.mouse_hist = [];

        // LRU cache of predicted waypoints when the mouse is moving.
        // Each element is a dict with keys `x`, `y`, and `item_id`.
        this.waypoints = [];
    }

    // Called by Ctxt when BE created a new canvas config - may happen (1)
    // initially, (2) after window resize, or (3) after zoom request.
    //
    // TODO: Allow user to switch the grid on/off.
    register_canvas_config(msg_dict) {
        // TODO: Event replay is not written yet.
        this.replayer.record_event('canvas', msg_dict);
        this.tile_set.add_config(msg_dict);

        // Cancel any selection/zoom going on, just in case.
        this.mouse_handler.reset();

        this.axis_handler.update(msg_dict);
    }

    // Called by Ctxt when we receive a new tile from BE: we add the tile to
    // either the visible layer or `tile_cache`.
    register_tile(tile, seqs) {
        // Update sequence #.
        for (let seq of seqs) {
            this.inflight_reqs.delete(seq);
            this.ack_seqs.push(seq);
        }

        this.replayer.log(
            `Received tile [${tile.sm_version}]${tile.key} seq=${seqs}`);

        this.received_tiles.push(tile);
        if (this.received_tiles.length == 1) {
            // Enable register_tile_cb(): it will process all tiles pushed into
            // `received_tiles` before it executes.
            setTimeout(() => { this.register_tile_cb() }, 0);
        }
    }

    // Triggered by register_tile() above.
    register_tile_cb() {
        let tiles = this.received_tiles;
        this.received_tiles = [];

        const keys = tiles.map(elem => elem.key);
        this.replayer.record_event('tile', {keys: keys});

        if (this.replayer.status == REPLAY_RUNNING) {
            if (this.tile_replay_cb) this.tile_replay_cb(tiles);
        }
        else
            this.register_tile_internal(tiles);
    }

    // During replay, generate a tile request for keys[idx].  Set up
    // `tile_replay_cb` to handle the received tile.
    tile_replay_handler(resolve, keys, idx) {
        if (idx == keys.length) {
            this.register_tile_internal(this.tile_replay_buf);
            this.tile_replay_cb = null;
            this.tile_replay_buf = [];

            resolve(true /* unused */);  // We're done!
            return;
        }

        const key = keys[idx];
        this.tile_replay_cb = (tiles) => {
            // We're receiving tiles one by one, so just check the first.
            let tile = tiles[0];

            if (tile.key == key) {
                this.tile_replay_buf.push(tile);
                idx++;
            }
            this.tile_replay_handler(resolve, keys, idx);
        };

        // Asking for tiles one by one is very inefficient, but let's not
        // bother, because we're just replaying.
        const [config_id, zoom_level, row, col, item_id] =
            key.split(':').map(v => parseInt(v));

        let ack_seqs = this.ack_seqs;
        this.ack_seqs = [];
        let next_seq = this.next_seq++;
        this.inflight_reqs.set(next_seq, Date.now());

        this.ctxt.send('tile_req', {
            ack_seqs: ack_seqs,
            config_id: config_id,
            zoom_level: zoom_level,
            items: [{id: item_id, prio: [`${row}:${col}:${next_seq}`], reg: []}]
        });
    }

    register_tile_internal(tiles) {
        let has_hover = false;
        for (let tile of tiles) {
            this.replayer.log(`Adding tile: ${tile.key}`);
            this.tile_set.add_tile(tile);
            has_hover = has_hover || tile.is_hover();
        }

        // Remove progress bar (if exists).
        if (this.tile_set.visible_tiles.size > 0) {
            const bar = this.canvas.querySelector('.cr_progressbar');
            if (bar) bar.remove();
        }

        // See if we can ask more tiles, if update was previously stalled.
        // TODO: Handle replay?
        if (this.tile_update_stalled) {
            const req = this.create_tile_req();
            if (req != null) {
                this.replayer.log('Sending new tile_req after stall:', req);
                this.ctxt.send('tile_req', req);
            }
        }

        // Re-compute best highlight, in case what we received is a
        // highglight tile.
        if (has_hover) {
            // If highlight was triggered via search, just re-set the same
            // item_id: it will pick up any new tile if applicable.
            if (this.tile_set.highlight_trigger == HIGHLIGHT_VIA_SEARCH) {
                this.tile_set.set_highlight(
                    this.tile_set.highlight_item_id, HIGHLIGHT_VIA_SEARCH);
            }
            else {
                this.recompute_highlight();
            }
        }
    }

    handle_panning(x_offset, y_offset) {
        this.tile_set.pan(x_offset, y_offset);
        this.request_new_tiles();

        // May send axis_req message if necessary.
        this.axis_handler.update_location(false);
    }

    // The mouse cursor is not moving: ask highlight tiles for exactly under the
    // cursor.
    handle_mouse_stop(x, y) {
        this.replayer.log(`handle_mouse_stop: ${x} ${y}`);
        let item_id = this.tile_set.get_highlight_id(x, y);
        if (item_id == 'unknown') return;
        this.replayer.log('current item_id = ', item_id);

        let buf = [{x : x, y: y, item_id: item_id}];
        const req = this.create_highlight_req(buf);
        if (req == null) return;

        this.replayer.log('Mouse stopped, highlight_req:', req);
        if (this.replayer.status != REPLAY_RUNNING) {
            this.ctxt.send('tile_req', req);

            if (req.throttled) {
                // We couldn't request all tiles: check later!
                this.mouse_handler.enqueue_mouse_stop_cb();
            }
        }
    }

    // On Linux, seems like mousemove callback is called roughly every ~10ms
    // on Chrome and ~15ms on Firefox.  So it should be OK to just update
    // history every time we get this callback.
    update_mouse_history(x, y) {
        let mouse_hist = this.mouse_hist;
        const rel_T = this.replayer.rel_time;
        const last_T =
            (mouse_hist.length) ? mouse_hist[mouse_hist.length - 1].t : 0;
        const new_item = {t: rel_T, x: x, y: y};

        // If the callback is being called too frequently, just replace the
        // last known position and return.
        if (rel_T - last_T < HISTORY_MIN_STEP_MSEC) {
            this.replayer.log(
                'update_mouse_history called too quickly: ignoring ...');
            mouse_hist[mouse_hist.length - 1] = new_item;
            return;
        }

        // Remove old history.
        let i = 0;
        while (i < mouse_hist.length &&
               mouse_hist[i].t < rel_T - HISTORY_WINDOW_MSEC) i++;
        if (i > 0) mouse_hist.splice(0, i);

        mouse_hist.push(new_item);
        this.replayer.log('mouse_hist = ', mouse_hist);
        if (mouse_hist.length <= 1)
            return;  // Can't do prediction with a single point!

        // Now let's do some linear algebra shit ...
        //
        // Given a list of N values (t_i, x_i), x = vt + x0, where
        //   v = [N*sum(tx) - sum(t) * sum(x)] / [N*sum(t^2) - sum(t)^2]
        //   x0 = [sum(x) - v * sum(t)] / N
        //
        // We subtract each time by rel_T to keep the numbers in a reasonable
        // range.
        //
        // TODO: Downweight older data points?
        let sum_t = 0.0, sum_t2 = 0.0, sum_x = 0.0, sum_y = 0.0;
        let sum_tx = 0.0, sum_ty = 0.0;
        const N = mouse_hist.length;

        for (const pt of mouse_hist) {
            const t = (pt.t - rel_T);
            sum_t += t;
            sum_t2 += t * t;
            sum_x += pt.x;
            sum_y += pt.y;
            sum_tx += t * pt.x;
            sum_ty += t * pt.y;
        }

        const D = N * sum_t2 - sum_t * sum_t;
        const Vx = (N * sum_tx - sum_t * sum_x) / D;
        const x0 = (sum_x - Vx * sum_t) / N;
        const Vy = (N * sum_ty - sum_t * sum_y) / D;
        const y0 = (sum_y - Vy * sum_t) / N;

        // Check if it "predicts" the current position well.  (Strictly
        // speaking, this is wrong, as we already used the current position
        // to compute A, B coefficients, but it will let us avoid
        // re-calculating the coefficients.)
        const dist = Math.sqrt(sqr(x - x0) + sqr(y - y0));
        this.replayer.log(
            `Mouse = (${x}, ${y}) / ` +
            `Predicted = (${x0.toFixed(2)}, ${y0.toFixed(2)}) / ` +
            `error (distance) = ${dist.toFixed(2)}`);

        if (dist > HISTORY_RESET_THRESHOLD) {
            // The current mouse position is too far from the predicted
            // position: reset the history.
            this.replayer.log(
                'Prediction error too high, resetting mouse history ...');
            mouse_hist.splice(0, mouse_hist.length - 1);
            return;
        }

        if (dist > PREDICT_ERROR_THRESHOLD) return;

        // "Draw" a prediction line from the current position.
        const x1 = Vx * PREDICT_STEP_MSEC + x0;
        const y1 = Vy * PREDICT_STEP_MSEC + y0;
        this.draw_prediction_line(x, y, x1, y1);
    }

    // Traverse a straight line between (x0, y0) and (x1, y1), check the
    // hovermap data, and add candidate waypoints.
    draw_prediction_line(x0, y0, x1, y1) {
        this.replayer.log(
            'draw_prediction_line() called: ' +
            `x0=${x0.toFixed(2)} y0=${y0.toFixed(2)} ` +
            `x1=${x1.toFixed(2)} y1=${y1.toFixed(2)}`);

        if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < 1.0) return;

        let buf = [];  // Buffer of waypoints.
        let item_cnt = 0;  // Number of differently highlighted regions.

        // Visit pixel (x, y) - return `true` if we want to continue.
        let visit = (x, y) => {
            x = Math.round(x); y = Math.round(y);
            const item_id = this.tile_set.get_highlight_id(x, y);

            if (item_id == 'unknown')
                return false;  // We have missing data: bail out.

            const item = {x: x, y: y, item_id: item_id};

            // If this is a new `item_id`, then append to the buffer.
            if (buf.length == 0 || buf[buf.length - 1].item_id != item_id) {
                buf.push(item);
                item_cnt += 1;

                // Try not to request too many different tiles.
                return (item_cnt <= MAX_COLORS_PER_PREDICT_STEP);
            }

            // Otherwise, we only add the initial and final points for any
            // stretch made of the same highlight ID (unless the stretch is
            // longer than MAX_PREDICTION_LINE_STEP).
            if (buf.length == 1) {
                buf.push(item);
                return true;
            }

            let penult = buf[buf.length - 2];
            if (penult.item_id != item_id) {
                buf.push(item);
                return true;
            }

            let dist2 = sqr(penult.x - x) + sqr(penult.y - y);
            if (dist2 < sqr(MAX_PREDICTION_LINE_STEP)) {
                buf[buf.length - 1] = item;
                return true;
            }
            else {
                buf.push(item);
                return true;
            }
        }

        if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
            let x = Math.round(x0);
            let xend = Math.round(x1);
            let slope = (y1 - y0) / (x1 - x0);
            if (x < xend) {
                for (; x <= xend; x++) {
                    let y = y0 + slope * (x - x0);
                    if (!visit(x, y)) break;
                }
            }
            else {
                for (; x >= xend; x--) {
                    let y = y0 + slope * (x - x0);
                    if (!visit(x, y)) break;
                }
            }
        }
        else {
            let y = Math.round(y0);
            let yend = Math.round(y1);
            let slope = (x1 - x0) / (y1 - y0);
            if (y < yend) {
                for (; y <= yend; y++) {
                    let x = x0 + slope * (y - y0);
                    if (!visit(x, y)) break;
                }
            }
            else {
                for (; y >= yend; y--) {
                    let x = x0 + slope * (y - y0);
                    if (!visit(x, y)) break;
                }
            }
        }

        // If we're here, we've got some candidate waypoints.
        const len1 = this.waypoints.length;
        const len2 = buf.length;
        if (len1 + len2 > MAX_WAYPOINT_CNT)
            this.waypoints.splice(0, len1 + len2 - MAX_WAYPOINT_CNT);
        this.replayer.log('Appending to waypoints:', buf);
        this.waypoints.push(...buf);

        // Send the request back to BE.
        const req = this.create_highlight_req(buf);
        if (req != null) {
            this.replayer.log('Sending highlight_req:', req);

            // If the replay is running, we already have previously recorded
            // tile response events which are replayed via event handlers.
            if (this.replayer.status != REPLAY_RUNNING)
                this.ctxt.send('tile_req', req);
        }
    }

    // Given a list of item ID's, check which tiles are missing and
    // construct a request for these missing tiles.
    //
    // A "waypoint" usually contains `x`, `y`, and `item_id`, when we're
    // called by label_mouse_handler(), it only contains `item_id` because
    // there's obviously no meaningful coordinate inside the search area.
    //
    // See messages.txt for `tile_req` message format.
    create_highlight_req(waypoints) {
        this.replayer.log('create_highlight_req: currently has ' +
                          `${this.inflight_reqs.size} in-flight requests.`);
        this.expire_old_requests();
        const all_coords = this.tile_set.get_all_tile_coords();

        // Map of "priority coordinates" (i.e., where the mouse cursor is
        // expected to pass) so that BE can compute them before others.
        let prio_coords = new Map();
        for (let waypoint of waypoints) {
            if (waypoint.item_id == null) continue;
            if (!prio_coords.has(waypoint.item_id)) {
                prio_coords.set(waypoint.item_id, new Set());
            }

            if ('x' in waypoint) {
                const [row, col] =
                    this.tile_set.get_tile_coord(waypoint.x, waypoint.y);
                prio_coords.get(waypoint.item_id).add(`${row}:${col}`);
            }
            else {
                // This is called by label_mouse_handler(): there's no
                // coordinate, so we consider everything as "priority".
                for (let [row, col] of all_coords)
                    prio_coords.get(waypoint.item_id).add(`${row}:${col}`);
            }
        }

        let throttled = false;
        let fill_tile_reqs = (tile_req_buf, item_id, is_prio) => {
            for (let [row, col] of all_coords) {
                const key = this.tile_set.tile_key(row, col, item_id);
                if (this.tile_set.has_tile(key)) {
                    // Nothing to do: we already have the tile!
                    // TODO: The tile may be evicted from the cache by the
                    // time we actually need it.  Do we have to take care of
                    // it?  Maybe it's OK to just re-request the tile in
                    // such a case...
                    continue;
                }

                const coord_str = `${row}:${col}`;
                if (is_prio == prio_coords.get(item_id).has(coord_str)) {
                    if (this.inflight_reqs.size >= MAX_INFLIGHT_REQUESTS) {
                        throttled = true;
                        return;
                    }

                    const seq = this.next_seq++;
                    this.inflight_reqs.set(seq, Date.now());
                    tile_req_buf.push(`${coord_str}:${seq}`);
                }
            }
        };

        let items = new Map();

        // First fill in all the priority tiles.
        for (let item_id of prio_coords.keys()) {
            let buf = [];
            fill_tile_reqs(buf, item_id, true /* is_prio */);
            if (buf.length > 0)
                items.set(item_id, {id: item_id, prio: buf, reg: []});
        }

        // Now fill in all the rest.
        for (let item_id of prio_coords.keys()) {
            let buf = [];
            fill_tile_reqs(buf, item_id, false /* !is_prio */);
            if (buf.length == 0) continue;

            if (items.has(item_id))
                items.get(item_id).reg = buf;
            else
                items.set(item_id, {id: item_id, prio: [], reg: buf});
        }

        if (items.size == 0) return null;

        const ack_seqs = this.ack_seqs;
        this.ack_seqs = [];
        return {
            ack_seqs: ack_seqs,
            config_id: this.tile_set.config_id,
            zoom_level: this.tile_set.zoom_level,
            items: Array.from(items.values()),
            throttled: throttled,
        };
    }

    // Find the best current matching item for highlight (it may not be the
    // one right under the mouse cursor, if the data is not available yet).
    // Then update highlight if necessary.
    recompute_highlight() {
        const [x, y] = [this.mouse_handler.mouse_x, this.mouse_handler.mouse_y];
        const [row, col] = this.tile_set.get_tile_coord(x, y);

        this.replayer.log(
            `recompute_highlight() called: ` +
            `x=${x} y=${y} row=${row} col=${col} ` +
            `state=${this.mouse_handler}`);

        // First, let's do an exhaustive search for all points within
        // EXHAUSTIVE_SEARCH_RADIUS of the current pixel.
        //
        // (`best_tile` is needed to draw the tooltip.)
        let best_tile = null;
        let best_item_id = null;
        let min_dist2 = sqr(MAX_DISTANCE);
        let best_x = null, best_y = null;

        const r = EXHAUSTIVE_SEARCH_RADIUS;
        const [ix, iy] = [Math.round(x), Math.round(y)];
        for (let xx = ix - r; xx <= ix + r; xx++) {
            for (let yy = iy - r; yy <= iy + r; yy++) {
                const dist2 = sqr(x - xx) + sqr(y - yy);
                if (dist2 >= min_dist2) continue;
                const item_id = this.tile_set.get_highlight_id(xx, yy);
                if (item_id == null || item_id == 'unknown') continue;

                const key = this.tile_set.tile_key(row, col, item_id);
                if (this.tile_set.has_tile(key)) {
                    best_tile = this.tile_set.get_tile(key);
                    best_item_id = item_id;
                    min_dist2 = dist2;
                    best_x = xx; best_y = yy;
                }
            }
        }
        this.replayer.log(
            `best_item_id found: ${best_item_id} from:`, best_x, best_y);

        // If we didn't find any, also check waypoints we computed so far, as
        // long as they're within MAX_DISTANCE.
        if (best_item_id == null && this.mouse_handler.move == 'moving') {
            for (let item of this.waypoints) {
                let dist2 = sqr(item.x - x) + sqr(item.y - y);
                if (dist2 >= min_dist2) continue;

                const key = this.tile_set.tile_key(row, col, item.item_id);
                if (this.tile_set.has_tile(key)) {
                    best_tile = this.tile_set.get_tile(key);
                    best_item_id = item.item_id;
                    min_dist2 = dist2;
                }
            }
        }

        // For debugging.
        this.replayer.log(`recompute_highlight: best id ${best_item_id} ` +
                          'current = ' + this.tile_set.highlight_item_id);
//      this.canvas.querySelector('.cr_dbg_status').textContent =
//          `x=${x} y=${y} best ID = ${best_item_id}`;
//          // + ' waypoints = ' + JSON.stringify(this.waypoints);

        if (SHOW_WAYPOINT_COMET) {
            for (let pt of this.canvas.querySelectorAll('.cr_dbgpt1, .cr_dbgpt2'))
                pt.remove();

            for (let item of this.waypoints) {
                let pt = document.createElement('div');
                // TODO: How to center this at the correct coordinate?
                pt.style.top = item.y + 'px';
                pt.style.left = item.x + 'px';
                if (item.item_id == null) {
                    pt.classList.add('cr_dbgpt1');
                    pt.textContent = 'N';
                } else {
                    pt.classList.add('cr_dbgpt2');
                    pt.textContent = item.item_id;

                }
                this.canvas.appendChild(pt);
            }
        }

        if (best_item_id != this.tile_set.highlight_item_id) {
            if (best_item_id != null) {
                this.highlight_change_time = this.replayer.rel_time;
                this.set_highlight(best_item_id, HIGHLIGHT_VIA_CANVAS);
            }
            else {
                this.highlight_change_time = null;
                this.clear_highlight();
            }
        }

        // Enable tooltip if the mouse is stopped.
        this.hide_tooltip();
        if (this.mouse_handler.move == 'stopped' && best_item_id != null) {
            this.replayer.log(
                `Activating tooltip for item #${best_item_id} ...`);

            this.tooltip.style.visibility = 'visible';
            this.tooltip.style.top = (y + TOOLTIP_OFFSET_Y) + 'px';
            this.tooltip.style.left = (x + TOOLTIP_OFFSET_X) + 'px';
            const color = best_tile.style.split(':')[0];
            this.tooltip.style.borderColor = '#' + color;

            let nearest_pt = this.nearest_pts.get(
                this.tile_set.config_id, this.tile_set.zoom_level,
                this.tile_set.x_offset, this.tile_set.y_offset,
                x, y, best_item_id);

            if (nearest_pt == null) {
                // Ask information about the nearest point.
                this.tooltip.textContent = best_tile.label;

                this.ctxt.send('pt_req', {
                    config_id: this.tile_set.config_id,
                    zoom_level: this.tile_set.zoom_level,
                    x_offset: Math.round(this.tile_set.x_offset),
                    y_offset: Math.round(this.tile_set.y_offset),
                    mouse_x: ix,
                    mouse_y: iy,
                    item_id: best_item_id,
                });

                return;
            }

            // This works due to "white-space: pre-wrap" in CSS.
            this.tooltip.textContent =
                best_tile.label + '\r\n' +
                `(${nearest_pt.data_x}, ${nearest_pt.data_y})`;
            this.axis_handler.update_crosshair(
                nearest_pt.screen_x, nearest_pt.screen_y);
        }
    }

    hide_tooltip() {
        this.tooltip.style.visibility = 'hidden';
        this.axis_handler.update_crosshair(null, null);
    }

    // Enable highlight layer with the given item.
    //
    // `trigger_type` indicates how this highlight was triggered: either
    // HIGHLIGHT_VIA_CANVAS or HIGHLIGHT_VIA_SEARCH.
    set_highlight(item_id, trigger_type) {
        this.replayer.log(`>>> Setting highlight to #${item_id} ...`);
        this.tile_set.set_highlight(item_id, trigger_type);

        if (this.highlighted_label != null &&
            this.highlighted_label.item_id != item_id)
            this.highlighted_label.update_highlight(false);

        let label = this.label_map.get(item_id);
        if (label != null) {
            this.highlighted_label = label;
            label.update_highlight(true);
        }

        this.update_T = this.replayer.rel_time;
        if (this.hide_cb) {
            window.clearTimeout(this.hide_cb);
            this.hide_cb = null;
        }
        this.fg.style.visibility = 'visible';
    }

    // Turn off the current highlighted item.
    // To avoid flickering, we actually set up a series of callbacks that may
    // run delayed - see set_hide_cb() below.
    clear_highlight() {
        this.replayer.log('clear_highlight() called.');
        this.set_hide_cb('clear2', () => this.clear_highlight2(),
                         MIN_HIGHLIGHT_DURATION_MSEC);
    }

    clear_highlight2() {
        this.replayer.log('>>> Clearing highlight ...');
        this.tile_set.set_highlight(null, null);
        if (this.highlighted_label != null) {
            this.highlighted_label.update_highlight(false);
            this.highlighted_label = null;
        }

        this.set_hide_cb('clear3', () => this.clear_highlight3(),
                         MIN_FG_VISIBLE_MSEC);
    }

    clear_highlight3() {
        this.replayer.log('>>> Hiding the foreground layer ...');
        this.fg.style.visibility = 'hidden';
    }

    // To avoid flapping, we don't immediately clear highlighting if it was on
    // for less than the given threshold.
    set_hide_cb(event_type, cb, threshold) {
        const rel_T = this.replayer.rel_time;
        const elapsed = rel_T - this.update_T;
        this.replayer.log(
            `now = ${rel_T} last update was ${this.update_T} ` +
            `(elasped = ${elapsed}) vs. threshold = ${threshold}`);
        if (elapsed >= threshold) {
            cb();
            return;
        }

        if (this.hide_cb) {
            window.clearTimeout(this.hide_cb);
            this.hide_cb = null;
        }

        this.replayer.log(`hide_cb will fire in ${threshold - elapsed} ms.`);
        if (this.replayer.status != REPLAY_RUNNING) {
            this.hide_cb = setTimeout(
                () => {
                    this.replayer.record_event(event_type, {});
                    cb();
                },
                threshold - elapsed
            );
        }
    }

    autoselect_handler(ev) {
        if (this.btn_autoselect.checked) {
            // Select all currently shown labels.
            for (let label of this.labels) {
                let checkbox = label.checkbox;
                if (checkbox != null) checkbox.checked = true;
            }

            this.ctxt.send('update_selection', {
                version: this.tile_set.new_sm_version(),
                how: 'exact',
                pat: this.searchbox.value,
                regex: this.btn_regex.checked
            });

            this.request_new_tiles();
        }
    }

    // If (ev == null) then we're being called manually by Ctxt: then we don't
    // need to update version because this should be the first call.
    search_handler(ev) {
        if (ev != null && this.btn_autoselect.checked) {
            this.ctxt.send('search', {
                version: this.tile_set.new_sm_version(),
                pat: this.searchbox.value,
                regex: this.btn_regex.checked,
            });
            this.request_new_tiles();
        }
        else {
            this.ctxt.send('search', {
                pat: this.searchbox.value,
                regex: this.btn_regex.checked,
            });
        }
    }

    // `command` is one of: select_all, deselect_all, select_matching,
    //                      deselect_matching.
    select_btn_handler(ev, command) {
        this.btn_autoselect.checked = false;
        this.btn_popup.hide();

        let msg = {version: this.tile_set.new_sm_version()};
        if (command == 'select_all' || command == 'deselect_all') {
            msg.pat = '';
            msg.regex = false;
        }
        else {
            msg.pat = this.searchbox.value;
            msg.regex = this.btn_regex.checked;
        }

        msg.how = ((command == 'select_all' || command == 'select_matching')
                       ? 'select' : 'deselect');

        this.ctxt.send('update_selection', msg);

        this.request_new_tiles();

        for (let label of this.labels)
            label.update_selected(msg.how == 'select');
    }

    // Update the "search result" area: called when we receive `labels` message
    // from BE.
    //
    // TODO: Refactor into a separate class?  TileHandler is getting longer and
    // longer ...
    update_search_result(msg_dict) {
        let old_labels = this.labels;
        this.labels = [];
        let new_labels = msg_dict.labels;
        new_labels.push([ITEM_ID_SENTINEL, false, '', '']);

        if (this.tile_set.highlight_trigger == HIGHLIGHT_VIA_SEARCH &&
            this.highlighted_label != null) {

            this.highlighted_label.update_highlight(false);
            this.highlighted_label = null;
            this.clear_highlight();
        }

        // Scan the list of existing labels (`old_labels`) and the list of new
        // labels to populate (`new_labels`): delete/create/copy as necessary.
        let old_idx = 0;
        let new_idx = 0;
        while (true) {
            const old_id = old_labels[old_idx].item_id;
            const [new_id, selected, label, style] = new_labels[new_idx];

            if (old_id < new_id) {
                // This label is no longer needed: delete.
                old_labels[old_idx].elem.remove();
                this.label_map.delete(old_id);
                if (this.highlighted_label === old_labels[old_idx])
                    this.highlighted_label = null;
                old_idx++;
                continue;
            }

            if (new_id < old_id) {
                // this.replayer.log('Creating new label: ', new_id, selected, label, style);

                // This is a new label: create and append.
                let new_label = new Label(
                    new_id, selected, label, style,
                    (label, ev) => this.label_mouse_handler(label, ev));

                let checkbox = new_label.checkbox;
                checkbox.addEventListener('change', (ev) => {
                    this.btn_autoselect.checked = false;
                    this.ctxt.send('update_selection', {
                        version: this.tile_set.new_sm_version(),
                        how: (checkbox.checked) ? 'select' : 'deselect',
                        ids: [new_id]
                    });
                    this.request_new_tiles();
                });

                this.search_result_area.insertBefore(
                    new_label.elem, old_labels[old_idx].elem);
                this.labels.push(new_label);
                this.label_map.set(new_id, new_label);
                new_idx++;
                continue;
            }

            // this.replayer.log('Re-using existing label for: ', new_id, selected, label, style);
            // this.replayer.log('Existing has: ',
            //     old_labels[old_idx].item_id,
            //     old_labels[old_idx].selected,
            //     old_labels[old_idx].label,
            //     old_labels[old_idx].style);

            // An existing label is still needed: copy to the new list.
            let existing_label = old_labels[old_idx];
            existing_label.update_selected(selected);
            this.labels.push(existing_label);
            if (old_id == ITEM_ID_SENTINEL) break;
            old_idx++;
            new_idx++;
        }

        // TODO: Add "show more" button?
        const len = this.labels.length - 1;
        let s = '';
        if (len == 0) s = 'No matching items.';
        else if (len == 1) s = '1 Matching item.';
        else if (len == msg_dict.count) s = `${len} matching items.`;
        else s = `Showing ${len} of ${msg_dict.count} matching items.`;

        this.search_stat_area.textContent = s;
    }

    // Called when the mouse pointer enters/leaves an item inside
    // this.search_result_area.
    //
    // Update highlight if any tile is available; otherwise turn it off.
    // Also send requests for highlight tiles if necessary.
    label_mouse_handler(label, ev) {
        this.replayer.log(
            `label_mouse_handler called: item_id=${label.item_id} ` +
            `event=${ev.type} current highlighted=${label.highlighted} ` +
            `classlist = ${label.elem.classList}`);

        const is_leave = (ev.type == 'mouseleave');
        if (!is_leave && !label.highlighted) {
            this.set_highlight(label.item_id, HIGHLIGHT_VIA_SEARCH);

            // Send request for missing tiles, if any.
            // TODO: This duplicates the logic of draw_prediction_line().
            const req = this.create_highlight_req([{item_id: label.item_id}]);
            if (req != null) {
                this.replayer.log('Sending highlight_req:', req);

                // If the replay is running, we already have previously recorded
                // tile response events which are replayed via event handlers.
                if (this.replayer.status != REPLAY_RUNNING)
                    this.ctxt.send('tile_req', req);
            }
        }
        else if (is_leave && label.highlighted) {
            this.clear_highlight();
        }
    }

    // Request new tiles: called after selection update and panning.
    // TODO: Handle replay?
    request_new_tiles() {
        const req = this.create_tile_req();
        if (req != null) {
            this.replayer.log('Sending new tile_req:', req);
            this.ctxt.send('tile_req', req);
        }
    }

    // Similar to create_highlight_req, but creates request for regular tiles
    // after selection map was updated.
    //
    // Since it may take much more time for BE to compute intersection
    // information, we try to send the request for *all* tiles, even if we go
    // over the MAX_INFLIGHT_REQUESTS limit.
    //
    // TODO: Refactor and merge with create_highlight_req?
    create_tile_req() {
        this.tile_update_stalled = false;

        let sm_version = this.tile_set.sm_version;
        this.replayer.log(
            `create_tile_req (version ${sm_version}): currently has ` +
            `${this.inflight_reqs.size} in-flight requests.`);
        this.expire_old_requests();

        if (this.inflight_reqs.size >= MAX_INFLIGHT_REQUESTS) {
            this.replayer.log("Too many in-flight requests, bailing out ...");
            this.tile_update_stalled = true;
            return null;
        }

        const all_coords = this.tile_set.get_all_tile_coords();
        let buf = [];
        for (let [row, col] of all_coords) {
            const key = this.tile_set.tile_key(row, col);
            const tile = this.tile_set.get_tile(key);
            if (tile == null || tile.sm_version < sm_version) {
                const seq = this.next_seq++;
                this.inflight_reqs.set(seq, Date.now());
                buf.push(`${row}:${col}:${seq}`);
            }
        }

        if (buf.length == 0) return null;

        const ack_seqs = this.ack_seqs;
        this.ack_seqs = [];
        return {
            ack_seqs: ack_seqs,
            config_id: this.tile_set.config_id,
            zoom_level: this.tile_set.zoom_level,
            items: [{version: sm_version, prio: buf, reg: []}],
            throttled: false,
        };
    }

    // Forget in-flight requests that are too old.
    expire_old_requests() {
        let deadline = Date.now() - INFLIGHT_REQ_EXPIRE_MSEC;
        for (let [seq_no, timestamp] of this.inflight_reqs) {
            if (timestamp < deadline) {
                this.replayer.log(`Forgetting old seq #${seq_no} ...`);
                this.inflight_reqs.delete(seq_no);
            }
        }
    }
}
