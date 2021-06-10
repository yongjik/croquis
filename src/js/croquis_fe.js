// Frontend module.
//
// cf. https://mindtrove.info/4-ways-to-extend-jupyter-notebook/#nb-extensions
//     https://jupyter-notebook.readthedocs.io/en/stable/extending/frontend_extensions.html

define([
    'module',  // myself
    'jquery',
    'require',
    'base/js/namespace'
], function(module, $, requirejs, Jupyter) {

//------------------------------------------------

'use strict';

const PROGRESSBAR_TIMEOUT = 500;  // ms
const TILE_SIZE = 256;

let css_loaded = null;  // Promise object.
let comm = null;  // Websocket communication channel provided by Jupyter.
let comm_ready = false;  // TODO: Do we need this?
let ctxt_map = {};  // Map of contexts by canvas IDs.

let sqr = (x) => x * x;

// Current time as string HH:MM:SS.mmm, for debug logging.
function get_timestamp_str() {
    let T = new Date();
    let fmt = (x, sz) => ('000' + x).slice(-sz);  // Seriously, no printf??
    return fmt(T.getHours(), 2) + ':' + fmt(T.getMinutes(), 2) + ':' +
           fmt(T.getSeconds(), 2) + '.' + fmt(T.getMilliseconds(), 3);
}

// Add a module-level resize handler.
$(window).resize(resize_handler);

function load_ipython_extension() {
    console.log('croquis_fe module loaded by Jupyter:', module.id);
    load_css(false /* !force_reload */);
}

// We need a separate function from load_ipython_extension() because during
// development we want to be able to reload this module (triggered by Python
// class `DisplayObj` via calling `require.undef`), but Jupyter only calls
// load_ipython_extension() for the very first invocation.
function init(force_reload, reopen_comm) {
    console.log('croquis_fe.init() called: ' +
                `force_reload=${force_reload} reopen_comm=${reopen_comm}`);
    load_css(force_reload);
    if (reopen_comm) {
        // See: https://jupyter-notebook.readthedocs.io/en/stable/comms.html
        comm = Jupyter.notebook.kernel.comm_manager.new_comm(
            'croquis', {'msg': 'FE_loaded'})
        comm.on_msg(msg_dispatcher);
    }
};

// Load CSS if necessary.
// cf. https://jupyter-contrib-nbextensions.readthedocs.io/en/latest/internals.html
function load_css(force_reload) {
    css_loaded = new Promise((resolve, reject) => {
        let existing_css = document.querySelector('head .croquis_fe_css');

        if (existing_css != null) {
            if (!force_reload) {
                console.log('croquis_fe: CSS is already loaded.');
                resolve();
                return;
            }
            console.log('croquis_fe: reloading CSS ..');
            existing_css.remove();
        }

        // module.id should be "nbextensions/croquis_fe_dev" (for dev
        // environment) or "nbextensions/croquis_fe/croquis_fe" (when installed
        // via package).
        const is_dev = (module.id.search('croquis_fe_dev') != -1);
        const module_name = (is_dev) ? 'croquis_fe_dev' : 'croquis_fe';
        let css_url = requirejs.toUrl(`./${module_name}.css`);
        console.log(`Loading CSS (force_reload=${force_reload}): ${css_url}`);

        let link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.classList.add('croquis_fe_css');
        link.href = css_url;
        link.onload = function() {
            console.log('CSS loaded !!!');
            resolve();
        };
        link.onerror = function() {
            // At least on Chrome, this seems to fire only when the CSS
            // link itself is unavailable.
            console.log('CSS load failure !!!');
            reject();
        };

        document.querySelector('head').appendChild(link);
    });
}

// Handles websocket message via Jupyter's channel.
function msg_dispatcher(msg) {
    // console.log('Received comm: ', msg);
    let data = msg.content.data;

    // TODO: I don't think BE_ready message serves any purpose.  Maybe
    // remove it?
    if (data.msg == 'BE_ready') {
        console.log('Backend is ready!');
        comm_ready = true;
        return;
    }

    let canvas_id = msg.content.data.canvas_id;
    if (!(canvas_id in ctxt_map)) {
        console.log('Unknown canvas_id: ', canvas_id);
        return;
    }

    // If exists, msg.buffers holds binary data (e.g., PNG images).
    ctxt_map[canvas_id].msg_handler(msg.content.data, msg.buffers || []);
}

function resize_handler() {
    for (let canvas_id in ctxt_map) ctxt_map[canvas_id].resize_handler();
}

// Counterpart of the C++ CanvasConfig class.
// TODO: Do we need it?
class CanvasConfig {
    constructor(id, w, h, x0, y0, x1, y1) {
        this.id = id;  // Config ID.
        this.w = w;
        this.h = h;
        this.x0 = x0;
        this.y0 = y0;
        this.x1 = x1;
        this.y1 = y1;
    }
}

// Utility class for managing a popup box that closes itself when the user
// clicks somewhere else.
// cf. https://stackoverflow.com/a/3028037
class PopupBox {
    constructor(target) {
        this.target = target;
        this.target.style.visibility = 'hidden';
        this.listener = null;
    }

    show() {
        this.target.style.visibility = 'visible';
        if (this.listener != null)
            document.removeEventListener('click', this.listener);

        this.listener = (ev) => {
            if (!this.target.contains(ev.target)) this.hide();
        };
        setTimeout(() => document.addEventListener('click', this.listener), 0);
    }

    hide() {
        this.target.style.visibility = 'hidden';
        if (this.listener != null) {
            document.removeEventListener('click', this.listener);
            this.listener = null;
        }
    }
}

// Constants for EventReplayer.
const REPLAY_DISABLED = 0;
const REPLAY_RECORDING = 1;
const REPLAY_RUNNING = 2;
const REPLAY_SPEED = 0.2;

// Utility class for recording and replaying events, for debugging.
//
// Currently it only supports replaying for highlight tiles.  Not sure if we'll
// ever support other features ...
class EventReplayer {
    // For each `event_type` in the record, fn_map[event_type] is a function
    // that takes a single dict as argument, and optionally returns a Promise
    // object that completes the callback.
    constructor(btns_div, fn_map) {
        this.btns_div = btns_div;
        if (btns_div == null) {
            this.enabled = false;  // We're disabled.
            return;
        }

        this.enabled = true;
        this.status_area = btns_div.querySelector('span');
        this.fn_map = fn_map;

        this.reset(REPLAY_DISABLED);

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
        this.reset(REPLAY_DISABLED);
        this.run_cb('reset', {}).then();
        this.status_area.textContent = '(Empty)';
    }

    start_recording() {
        if (!this.enabled) return;
        this.reset(REPLAY_RECORDING);
        this.run_cb('reset', {}).then();
        this.status_area.textContent = 'Recording ...';
    }

    stop_recording() {
        if (!this.enabled) return;
        this.status = REPLAY_DISABLED;
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
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }

    load() {
        if (!this.enabled) return;

        // Stolen from https://stackoverflow.com/a/50782106
        let input = document.createElement('input');
        input.type = 'file';
        input.style.display = MOUSE_STATE_UP;

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
    record_event(event_type, args) {
        if (!this.enabled) return;

        if (this.status != REPLAY_RUNNING)
            this.rel_time = Date.now() - this.start_T;

        if (this.status != REPLAY_RECORDING) return;

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
            this.reset(REPLAY_RUNNING);
            this.run_cb('reset', {}).then();
            this.replay_event(0);
        }
    }

    replay_event(idx) {
        if (!this.enabled) return;

        if (this.status != REPLAY_RUNNING) return;  // Reply disabled.

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
            setTimeout(() => { this.replay_event(idx) },
                       (next_rel_T - this.rel_time) / REPLAY_SPEED);

            this.status_area.textContent = `Executed ${event_str}.`;
        })
        .catch(error => {
            this.status_area.textContent =
                `Error executing ${event_str}: ${error}`;
            this.status = REPLAY_DISABLED;
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

        if (status != REPLAY_RUNNING) this.events = [];
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

        if (this.status == REPLAY_DISABLED) return;
        const rel_T =
            (this.status == REPLAY_RUNNING) ? this.rel_time
                                            : Date.now() - this.start_T;
        const s = args.map(
            e => ((typeof(e) == 'object') ? JSON.stringify(e) : e)
        ).join(' ');
        this.event_log.push(`${get_timestamp_str()}    [${rel_T}] ${s}`);
    }
}

// Utility class for LRU cache.
class LRUCache {
    // `should_replace` is a callback function - see insert() below.
    constructor(maxsize, should_replace) {
        this.maxsize = maxsize;
        this.should_replace = should_replace;
        this.d = new Map();
    }

    clear() { this.d.clear(); }
    delete(key) { return this.d.delete(key); }
    get(key) { return this.d.get(key); }
    has(key) { return this.d.has(key); }
    size() { return this.d.size; }

    // Insert key/value pair: if the same key already exists, we call
    // should_replace(old item, new item), and replaces the old item iff it
    // returns true.
    insert(key, value) {
        let old = this.get(key);
        if (old != undefined && !this.should_replace(this.get(key), value))
            return;

        this.d.delete(key);
        while (this.d.size >= this.maxsize)
            this.d.delete(this.d.keys().next().value);
        this.d.set(key, value);
    }

    pop(key) {
        let v = this.d.get(key);
        if (v == undefined) return null;
        this.d.delete(key);
        return v;
    }
}

// A tile key does not contain `sm_version` because we want to use the latest
// available version even if the "correct" (latest requested) version is not
// available yet.
function tile_key(config_id, zoom_level, row, col, item_id = null) {
    if (item_id == null)
        return `${config_id}:${zoom_level}:${row}:${col}`;
    else
        return `${config_id}:${zoom_level}:${row}:${col}:${item_id}`;
}

class Tile {
    constructor(msg_dict, attachments) {
        const is_hover = 'item_id' in msg_dict;

        this.sm_version = msg_dict.sm_version;  // Selection map version.
        this.config_id = msg_dict.config_id;
        this.zoom_level = msg_dict.zoom;
        this.row = msg_dict.row;
        this.col = msg_dict.col;
        this.item_id = is_hover ? msg_dict.item_id : null;

        this.key = tile_key(this.config_id, this.zoom_level,
                            this.row, this.col, this.item_id);

        const png_data = attachments[0];
        this.elem = new Image(TILE_SIZE, TILE_SIZE);
        this.elem.classList.add('cr_tile');
        this.elem.setAttribute('draggable', false);
        this.elem.src = URL.createObjectURL(
            new Blob([png_data], {type: 'image/png'}));

        // Hovermap data is available only if this is *not* a hover (i.e.,
        // highlight) image.
        if (!is_hover)
            this.hovermap = attachments[1];  // Type DataView.
    }

    is_hover() {
        return this.item_id != null;
    }
}

const LABEL_SVG_WIDTH = 40;  // px
const LABEL_SVG_HEIGHT = 8;  // px
const LABEL_MARKER_SIZE_MAX = 8;  // px
const LABEL_LINE_WIDTH_MAX = 5;  // px
const ITEM_ID_SENTINEL = Number.MAX_SAFE_INTEGER;

// A label shown in the legend (search result) section.
class Label {
    constructor(item_id, selected, label, style, cb) {
        this.item_id = item_id;
        this.selected = selected;
        this.label = label;
        this.style = style;

        if (item_id == ITEM_ID_SENTINEL) {
            // This must be `null`, because its value is used as an argument to
            // search_result_area.insertBefore() inside TileHandler.
            this.elem = null;
            return;
        }

        this.elem = document.createElement('li');

        this.checkbox = document.createElement('input');
        this.checkbox.type = 'checkbox';
        this.checkbox.checked = this.selected;
        this.elem.appendChild(this.checkbox);

        this.elem.appendChild(this.create_line_svg());

        this.elem.appendChild(document.createTextNode(this.label));
    }

    set_selected(selected) {
        if (this.item_id == ITEM_ID_SENTINEL) return;
        this.selected = selected;
        this.checkbox.checked = selected;
    }

    // Create a simple line/marker image to show in the legend.
    create_line_svg() {
        const [w, h] = [LABEL_SVG_WIDTH, LABEL_SVG_HEIGHT];
        const [w2, h2] = [w / 2, h / 2];

        let [color, marker_size, line_width] = this.style.split(':');
        marker_size = Math.min(marker_size, LABEL_MARKER_SIZE_MAX);
        line_width = Math.min(line_width, LABEL_LINE_WIDTH_MAX);

        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('width', `${w}px`);
        svg.setAttribute('height', `${h}px`);

        let path =
            document.createElementNS("http://www.w3.org/2000/svg", 'path');
        path.setAttribute('stroke', '#' + color);
        path.setAttribute('stroke-width', line_width);
        path.setAttribute('d', `M 0,${h2} L ${w},${h2}`);
        svg.appendChild(path);

        let cir =
            document.createElementNS("http://www.w3.org/2000/svg", 'circle');
        cir.setAttribute('cx', w2);
        cir.setAttribute('cy', h2);
        cir.setAttribute('r', marker_size / 2);
        cir.setAttribute('fill', '#' + color);
        svg.appendChild(cir);

        return svg;
    }
}

const TILE_CACHE_MAXSIZE = 500;

// Keeps track of the tiles currently being shown in the canvas.
//
// We keep the outer div (.cr_canvas) with "overflow: hidden", and the
// inner div (.cr_inner) in it with "overflow: visible", and then the Tiles
// are children of the inner div, with "position: absolute".  In this way,
// we can pan the whole image by adjusting top/left value of the inner div.
//
// See also display.py.
//
// TODO: Panning support is not written yet!
//
// TODO: Do we need a separate class for this?  Or merge back into Ctxt?
class TileSet {
    constructor(ctxt) {
        // Canvas is not initialized yet.
        this.width = this.height = null;

        let canvas = ctxt.canvas;
        this.inner_div = canvas.querySelector('.cr_inner');
        this.fg = canvas.querySelector('.cr_foreground');

        this.canvas_id = canvas.id;
        this.configs = {};  // TODO: Do we need this?

        // Current `SelectionMap` version: always even.
        // Incremented by 2 whenever selection changes.
        this.sm_version = 0;

        this.config_id = null;  // No canvas config available yet.
        this.zoom_level = 0;
        this.highlight_item_id = null;

        // Panning offset, using screen coordinate.  E.g., if offset is (10, 3),
        // then the tiles are shifted 10 pixels to the right and 3 pixels down.
        // TODO: Should we move the whole cr_inner/cr_foreground instead of
        //       moving individual tiles?  During panning, we may end up only
        //       moving some tiles and it would look awful ...
        this.x_offset = 0;
        this.y_offset = 0;

        // Collection of tiles currently being shown.
        this.visible_tiles = new Map();

        // LRU Cache of tiles currently *not* being shown.
        this.tile_cache = new LRUCache(
            TILE_CACHE_MAXSIZE,
            (oldv, newv) => oldv.sm_version < newv.sm_version);
    }

    add_config(msg) {
        this.config_id = msg.config_id;
        this.zoom_level = 0;
        this.configs[msg.config_id] = msg;
            // TODO: use CanvasConfig class above?

        this.height = msg.h;
        this.width = msg.w;

        this.x_offset = 0;
        this.y_offset = 0;
    }

    // Return true if we have this tile.
    has_tile(key) {
        return this.visible_tiles.has(key) || this.tile_cache.has(key);
    }

    get_tile(key) {
        return this.visible_tiles.get(key) || this.tile_cache.get(key) || null;
    }

    // Add a new tile to TileSet.
    add_tile(tile) {
        // If the tile is not visible, simply add to the tile cache.
        if (!this.is_visible(tile)) {
            this.tile_cache.insert(tile.key, tile);
            return;
        }

        // If we have a previous existing version, check sm_version and keep the
        // newer one.
        let existing = this.visible_tiles.get(tile.key);
        if (existing != undefined)  {
            if (existing.sm_version < tile.sm_version)
                this.show_tile(tile, existing);
            else
                return;  // Nothing to do.
        }
        else
            this.show_tile(tile);
    }

    // Enable highlight layer with the given item.  If `item_id == null`,
    // turn off the highlight layer.
    set_highlight(item_id) {
        this.highlight_item_id = item_id;

        // Remove already existing highlight tiles if necessary.
        for (let tile of this.visible_tiles.values()) {
            if (!tile.is_hover() || tile.item_id == item_id)
                continue;

            // This removes `tile` from `visible_tiles` while we're
            // iterating, but seems like it's safe.
            // cf. https://stackoverflow.com/questions/35940216
            if (item_id == null) {
                this.hide_tile(tile);
                continue;
            }

            // If the corresponding tile exists in cache, replace tile here
            // (instead of removing and adding).
            const matching_key = this.tile_key(tile.row, tile.col, item_id);
            let matching = this.tile_cache.pop(matching_key);
            if (matching != null)
                this.show_tile(matching, tile);
            else
                this.hide_tile(tile);
        }

        // Add all available tiles for `item_id`.
        for (let [row, col] of this.get_all_tile_coords()) {
            const key = this.tile_key(row, col, item_id);
            let tile = this.tile_cache.pop(key);
            if (tile != null) this.show_tile(tile);
        }
    }

    // Update panning: update the position of all shown tiles, and optionally
    // show cached tiles as necessary.
    pan(new_x_offset, new_y_offset) {
        this.x_offset = new_x_offset;
        this.y_offset = new_y_offset;
        for (let tile of this.visible_tiles.values()) {
            if (this.is_visible(tile))
                this.update_tile_position(tile);
            else
                this.hide_tile(tile);
        }

        for (let [row, col] of this.get_all_tile_coords()) {
            const key = this.tile_key(row, col);
            let tile = this.tile_cache.pop(key);
            if (tile != null) this.show_tile(tile);
        }
    }

    // Add a tile to the visible layer.  When called, `tile` should not be in
    // any collection or DOM.
    //
    // If `existing` is given, we use replaceChild().  In that case, `existing`
    // should be inside this.visible_tiles when called.
    //
    // TODO: Handle panning.
    show_tile(tile, existing = null) {
        this.update_tile_position(tile);
        let target = tile.is_hover() ? this.fg : this.inner_div;

        if (existing != null) {
            this.visible_tiles.delete(existing.key);
            target.replaceChild(tile.elem, existing.elem);

            if (existing.key != tile.key)
                this.tile_cache.insert(existing.key, existing);
        }
        else {
            target.appendChild(tile.elem);
        }

        this.visible_tiles.set(tile.key, tile);
    }

    update_tile_position(tile) {
        tile.elem.style.top = (tile.row * TILE_SIZE + this.y_offset) + 'px';
        tile.elem.style.left = (tile.col * TILE_SIZE + this.x_offset) + 'px';
    }

    // Hide a tile that is currently in the visible layer, and add it back
    // to the tile cache.
    hide_tile(tile) {
        this.visible_tiles.delete(tile.key);
        tile.elem.remove();  // Remove from display.
        this.tile_cache.insert(tile.key, tile);
    }

    // Given screen coordinate (x, y), return the corresponding hovermap
    // data, or `null` if the pixel is not on any item, or the literal
    // string 'unknown' if the data is not available.
    get_highlight_id(x, y) {
        x = Math.round(x - this.x_offset);
        y = Math.round(y - this.y_offset);

        const row = Math.floor(y / TILE_SIZE);
        const col = Math.floor(x / TILE_SIZE);
        const offset_y = y - (row * TILE_SIZE);
        const offset_x = x - (col * TILE_SIZE);
        const offset = (offset_y * TILE_SIZE) + offset_x;

        const key = this.tile_key(row, col);
        if (!this.visible_tiles.has(key)) return 'unknown';
        const hovermap = this.visible_tiles.get(key).hovermap;

        let item_id = hovermap.getInt32(offset * 4, true /* little endian */);
        return (item_id == -1) ? null : item_id;
    }

    // Check if the given tile is visible.
    //
    // TODO: Need to handle temporarily visible tiles (e.g., when we zoom
    //       in, we need to show exiting tiles in higher zoom before we get
    //       the correct tiles from BE.)
    is_visible(tile) {
        if (tile.is_hover() && tile.item_id != this.highlight_item_id)
            return false;

        // For now, consider any tile as visible if config_id & zoom level
        // matches.
        //
        // TODO: Actually need to check coordinates to handle panning!
        return tile.config_id == this.config_id &&
               tile.zoom_level == this.zoom_level;
    }

    // Given screen coordinate (x, y), return the corresponding tile
    // coordinate.
    get_tile_coord(x, y) {
        x = Math.round(x - this.x_offset);
        y = Math.round(y - this.y_offset);

        const row = Math.floor(y / TILE_SIZE);
        const col = Math.floor(x / TILE_SIZE);
        return [row, col];
    }

    // Get a list of all tile coordinates covering the canvas.
    get_all_tile_coords() {
        if (this.width == null || this.height == null) {
            console.log(
                'Error: create_highlight_req called before ' +
                'width/height is available???');
            return [];
        }

        let retval = []
        const r0 = Math.floor(-this.y_offset / TILE_SIZE);
        const c0 = Math.floor(-this.x_offset / TILE_SIZE);
        const r1 = Math.ceil((this.height - this.y_offset) / TILE_SIZE) - 1;
        const c1 = Math.ceil((this.width - this.x_offset) / TILE_SIZE) - 1;
        for (let row = r0; row <= r1; row++) {
            for (let col = c0; col <= c1; col++) {
                retval.push([row, col]);
            }
        }

        return retval;
    }

    // Utility function.
    tile_key(row, col, item_id = null) {
        return tile_key(this.config_id, this.zoom_level, row, col, item_id);
    }

    // Increment and return a new sm_version.
    new_sm_version() {
        return (this.sm_version += 2);
    }
}

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
        this.tick.classList.add(`cr_tick`);

        this.label = document.createElement('div');
        this.label.classList.add(`cr_label`);
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

const INFLIGHT_REQ_EXPIRE_MSEC = 5000;
const REQUEST_NEW_LABELS_DIST_THRESHOLD = 30;

class AxisHandler {
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
    update_location() {
        for (let tick of this.ticks) tick.update_location();

        // Check if we have drifted far enough to need new labels.
        let tile_set = this.tile_handler.tile_set;
        let dist2 = sqr(tile_set.x_offset - this.last_x_offset) +
                    sqr(tile_set.y_offset - this.last_y_offset);
        if (dist2 < sqr(REQUEST_NEW_LABELS_DIST_THRESHOLD)) return;

        this.tile_handler.replayer.log('Creating new axis_req message ...');

        if (this.inflight_reqs.size >= 2) {
            this.tile_handler.replayer.log(
                'Too many in-flight axis requests, bailing out ...');
            return;
        }

        const seq = this.next_seq++;
        this.inflight_reqs.set(seq, Date.now());
        const req = {
            config_id: tile_set.config_id,
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
}

// Constants for TileHandler.
//
// TODO: The highlight algorithm is too complicated: we can probably remove some
//       part without issues.
const HISTORY_MIN_STEP_MSEC = 5.0;
const HISTORY_WINDOW_MSEC = 150.0;
const PREDICT_STEP_MSEC = 20.0;

const MOUSE_STOP_THRESHOLD_MSEC = 30.0;
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

const MIN_SELECT_AREA_DIAG = 5;  // pixels

// Draw the "comet" showing mouse event positions, for debugging.
// WARNING: takes a lot of resource - should be off when debugging performance!
const SHOW_WAYPOINT_COMET = false;

class TileHandler {
    constructor(ctxt) {
        // Used when replaying tile events, to keep context.
        this.tile_replay_cb = null;
        this.tile_replay_buf = [];

        // Initialize replay handler for debugging.
        let btns_div = document.querySelector(`#${ctxt.canvas_id}-btns`);
        this.replayer = new EventReplayer(btns_div, {
            reset: () => {
                this.tile_set.set_highlight(null);
                this.tile_set.tile_cache.clear();
                this.reset_state();
            },

            // TODO!
            // register_canvas_config: (args) => { what here? }

            mouse: (args) => {
                this.mouse_x = args.x;
                this.mouse_y = args.y;
                this.mouse_btns = args.btns;
                this.mouse_handler(args.name);
            },

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
        // XXX
        // this.x_axis = qs('.cr_x_axis');
        // this.y_axis = qs('.cr_y_axis');
        this.axis_handler = new AxisHandler(ctxt, this);
        this.fg = this.canvas.querySelector('.cr_foreground');

        this.zoom_radio_btn = qs(`#${ctxt.canvas_id}-zoom`);
        this.mouse_state = 'up';  // One of 'up', 'select' (to zoom), or 'pan'.

        // TODO: Now we're using "selection" to refer to the selection of items
        // inside the search box, but here we're also using "select" to mean
        // area selected by drag-to-zoom!  Rename this to drag_zoom_area?
        this.select_area = this.canvas.querySelector('.cr_select_area');

        // Mouse position when we started either "select and zoom" or panning.
        // (When this.mouse_state == 'up', this value has no meaning.)
        this.drag_start_x = this.drag_start_y = null;

        // Canvas offset when we started panning.
        this.x_offset0 = this.y_offset0 = null;

        // True if we started select/panning and then moved the mouse cursor out
        // of the canvas.
        this.mouseleave_fired = false;

        // TODO: Support replay?
        this.searchbox = qs('.cr_searchbox input');
        this.searchbox.addEventListener(
            'input', (ev) => this.search_handler(ev));

        this.search_result_area = qs('.cr_search_result');
        // Keeps track of labels in the search result area.
        this.labels = [new Label(ITEM_ID_SENTINEL, false, null, null)];

        (this.btn_regex = qs('.cr_regex')).addEventListener(
            'change', (ev) => this.search_handler(ev));
        (this.btn_autoselect = qs('.cr_autoselect')).addEventListener(
            'change', (ev) => this.autoselect_handler(ev));

        this.btn_popup = new PopupBox(qs('.cr_btn_popup'));

        qs('.cr_more').addEventListener('click', (ev) => {
            if (this.searchbox.value != '') {
                this.btn_select_matching.textContent =
                    'Select all matching ' + this.searchbox.value;
                this.btn_select_matching.style = 'visible';
                this.btn_deselect_matching.textContent =
                    'Deselect all matching ' + this.searchbox.value;
                this.btn_deselect_matching.style = 'visible';
            }
            else {
                this.btn_select_matching.style = 'hidden';
                this.btn_deselect_matching.style = 'hidden';
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

        for (let evname of ['mousedown', 'mouseleave',
                            'mousemove', 'mouseup']) {
            this.canvas.addEventListener(evname, (ev) => {
                if (this.replayer.status == REPLAY_RUNNING) return;

                let rect = this.canvas.getBoundingClientRect();
                this.mouse_x = ev.clientX - rect.left;
                this.mouse_y = ev.clientY - rect.top;
                this.mouse_btns = ev.buttons;

                this.mouse_handler(evname, ev.buttons);
            });
        }
    }

    // Utility function for initializing/resetting internal state.
    reset_state() {
        this.update_T = null;  // Last time highlight was changed.
        this.hide_cb = null;  // Set if we want to hide the foreground.
        this.mouse_stopped_cb = null;
            // Fires if mouse doesn't move for a while.
        this.highlight_change_time = null;
            // Last time the highlighted item was changed.

        // The current mouse position.
        this.mouse_x = this.mouse_y = null;

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
        this.clear_select_area();
        this.mouse_state = 'up';

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
            has_hover ||= tile.is_hover();
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
        if (has_hover) this.update_highlight(true);
    }

    // `evname`: event name (or 'stopped' if we're called by `mouse_stopped_cb`.
    mouse_handler(evname) {
        const [x, y, btns] = [this.mouse_x, this.mouse_y, this.mouse_btns];
        this.replayer.record_event(
            'mouse', {name: evname, x: x, y: y, btns: btns});

        if (evname == 'mousemove' && this.mouse_stopped_cb) {
            window.clearTimeout(this.mouse_stopped_cb);
            this.mouse_stopped_cb = null;
        }

        if (evname == 'mouseleave') {
            this.mouseleave_fired = true;
            this.clear_highlight();
        }

        // Since mousedown/mouseup events can trigger for other buttons we don't
        // care about, let's just compare the previous and current state of the
        // primary (= "left") button and use that to decide next action.
        if (['mousedown', 'mousemove', 'mouseup'].includes(evname)) {
            const btn_was_pressed = (this.mouse_state != 'up');
            const btn_is_pressed = ((btns & 1) == 1);

            if (evname == 'mousedown' && !btn_was_pressed && btn_is_pressed)
                evname = 'mousedown';
            else if (btn_was_pressed && !btn_is_pressed)
                evname = 'mouseup';
            else
                evname = 'mousemove';

            if (btn_is_pressed) this.mouseleave_fired = false;
        }

        const transition = `${this.mouse_state}->${evname}`;

        switch (transition) {
          // 'mousedown' can only happen during the 'up' state.
          case 'up->mousedown':
            this.clear_highlight();
            this.drag_start_x = x;
            this.drag_start_y = y;

            if (this.zoom_radio_btn.checked) {
                this.mouse_state = 'select';
            }
            else {
                this.mouse_state = 'pan';
                this.drag_start_x = x;
                this.drag_start_y = y;
                this.x_offset0 = this.tile_set.x_offset;
                this.y_offset0 = this.tile_set.y_offset;
            }

            return;

          case 'up->mousemove':
            // Update mouse history.
            this.update_mouse_history(x, y);

            // Enqueue "mouse stopped" callback which will be called if the
            // mouse cursor doesn't move for MOUSE_STOP_THRESHOLD_MSEC.
            if (this.replayer.status != REPLAY_RUNNING) {
                this.mouse_stopped_cb = setTimeout(
                    () => this.mouse_handler('stopped'),
                    MOUSE_STOP_THRESHOLD_MSEC
                );
            }

            this.update_highlight(true);
            return;

          case 'select->mousemove':
            this.show_select_area(x, y);
            return;

          case 'pan->mousemove':
            this.handle_panning(this.x_offset0 + x - this.drag_start_x,
                                this.y_offset0 + y - this.drag_start_y);
            return;

          case 'up->mouseleave':
            return;  // Nothing to do.

          case 'select->mouseleave':
            this.clear_select_area();
            return;

          case 'pan->mouseleave':
            // Hmm seems like it's better to *not* reset when the cursor goes
            // out of canvas ..
            // this.handle_panning(this.x_offset0, this.y_offset0);
            return;

          case 'select->mouseup':
            if (!this.mouseleave_fired) {
                let diag_len = Math.sqrt(sqr(this.drag_start_x - x) +
                                         sqr(this.drag_start_y - y));
                if (diag_len < MIN_SELECT_AREA_DIAG) {
                    this.replayer.log('Selected area too small, ignoring ...');
                }
                else {
                    const req = {
                        config_id: this.tile_set.config_id,
                        zoom_level: this.tile_set.zoom_level,
                        x0: this.drag_start_x - this.tile_set.x_offset,
                        y0: this.drag_start_y - this.tile_set.y_offset,
                        x1: x - this.tile_set.x_offset,
                        y1: y - this.tile_set.y_offset,
                    };
                    this.replayer.log('Sending zoom request:', req);
                    this.ctxt.send('zoom_req', req);
                }
            }

            this.clear_select_area();
            this.mouse_state = 'up';
            return;

          case 'pan->mouseup':
            if (!this.mouseleave_fired) {
                this.handle_panning(this.x_offset0 + x - this.drag_start_x,
                                    this.y_offset0 + y - this.drag_start_y);
            }

            this.mouse_state = 'up';
            return;

          case 'up->stopped':
            this.handle_mouse_stop(x, y);
            this.update_highlight(false);
            return;
        }
    }

    show_select_area(x1, y1) {
        const [x0, y0] = [this.drag_start_x, this.drag_start_y];

        this.select_area.style.visibility = 'visible';
        this.select_area.style.top = Math.min(y0, y1) + 'px';
        this.select_area.style.left = Math.min(x0, x1) + 'px';
        this.select_area.style.width = Math.abs(x0 - x1) + 'px';
        this.select_area.style.height = Math.abs(y0 - y1) + 'px';
    }

    clear_select_area() {
        this.select_area.style.visibility = 'hidden';
    }

    handle_panning(x_offset, y_offset) {
        this.tile_set.pan(x_offset, y_offset);
        this.request_new_tiles();

        // May send axis_req message if necessary.
        this.axis_handler.update_location();
    }

    // The mouse cursor is not moving: ask highlight tiles for exactly under the
    // cursor.
    handle_mouse_stop(x, y) {
        let item_id = this.tile_set.get_highlight_id(x, y);
        if (item_id == 'unknown') return;

        let buf = [{x : x, y: y, item_id: item_id}];
        const req = this.create_highlight_req(buf);
        if (req == null) return;

        this.replayer.log('Mouse stopped, highlight_req:', req);
        if (this.replayer.status != REPLAY_RUNNING) {
            this.ctxt.send('tile_req', req);

            if (req.throttled) {
                // We couldn't request all tiles: check later!
                this.mouse_stopped_cb = setTimeout(
                    () => this.mouse_handler('stopped'),
                    MOUSE_STOP_THRESHOLD_MSEC
                );
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
    // See messages.txt for `tile_req` message format.
    create_highlight_req(waypoints) {
        this.replayer.log('create_highlight_req: currently has ' +
                          `${this.inflight_reqs.size} in-flight requests.`);
        this.expire_old_requests();

        // Map of "priority coordinates" (i.e., where the mouse cursor is
        // expected to pass) so that BE can compute them before others.
        let prio_coords = new Map();
        for (let waypoint of waypoints) {
            if (waypoint.item_id == null) continue;
            if (!prio_coords.has(waypoint.item_id)) {
                prio_coords.set(waypoint.item_id, new Set());
            }

            const [row, col] =
                this.tile_set.get_tile_coord(waypoint.x, waypoint.y);
            prio_coords.get(waypoint.item_id).add(`${row}:${col}`);
        }

        const all_coords = this.tile_set.get_all_tile_coords();
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
    update_highlight(is_mouse_moving) {
        const [x, y] = [this.mouse_x, this.mouse_y];
        const [row, col] = this.tile_set.get_tile_coord(x, y);

        this.replayer.log(
            `update_highlight() called: x=${x} y=${y} row=${row} col=${col}`);

        // First, let's do an exhaustive search for all points within
        // EXHAUSTIVE_SEARCH_RADIUS of the current pixel.
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
        if (best_item_id == null && is_mouse_moving) {
            for (let item of this.waypoints) {
                let dist2 = sqr(item.x - x) + sqr(item.y - y);
                if (dist2 >= min_dist2) continue;

                const key = this.tile_set.tile_key(row, col, item.item_id);
                if (this.tile_set.has_tile(key)) {
                    best_item_id = item.item_id;
                    min_dist2 = dist2;
                }
            }
        }

        // For debugging.
        this.replayer.log(`update_highlight: best id ${best_item_id} ` +
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

        if (best_item_id == this.tile_set.highlight_item_id)
            return;  // The "best" matches our current state.

        if (best_item_id != null) {
            this.highlight_change_time = this.replayer.rel_time;
            this.set_highlight(best_item_id);
        }
        else {
            this.highlight_change_time = null;
            this.clear_highlight();
        }
    }

    // Enable highlight layer with the given item.
    set_highlight(item_id) {
        this.replayer.log(`>>> Setting highlight to #${item_id} ...`);
        this.tile_set.set_highlight(item_id);

        this.update_T = this.replayer.rel_time;
        if (this.hide_cb) {
            window.clearTimeout(this.hide_cb);
            this.hide_cb = null;
        }
        this.fg.style.visibility = 'visible';
    }

    // Turn off the current highlighted item.
    clear_highlight() {
        this.replayer.log('clear_highlight() called.');
        this.set_hide_cb('clear2', () => this.clear_highlight2(),
                         MIN_HIGHLIGHT_DURATION_MSEC);
    }

    clear_highlight2() {
        this.replayer.log('>>> Clearing highlight ...');
        this.tile_set.set_highlight(null);
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

    search_handler(ev) {
        if (this.btn_autoselect.checked) {
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

        for (let label of this.labels) {
            let checkbox = label.checkbox;
            if (checkbox != null) checkbox.checked = (msg.how == 'select');
        }
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
                old_idx++;
                continue;
            }

            if (new_id < old_id) {
                // this.replayer.log('Creating new label: ', new_id, selected, label, style);

                // This is a new label: create and append.
                let new_label = new Label(new_id, selected, label, style);

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
            existing_label.set_selected(selected);
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

// Current setup:
//  - div #croquis_nbext : outermost container
//    - div #{{canvas_id}}-btns : buttons for debugging
//    - div #{{canvas_id}} .cr_main : the whole area including axes
//      - div .cr_ctrl_panel  : "Control panel" at the top.
//      - div .cr_main1
//        - div .cr_y_axis : y axis
//        - div cr_canvas_plus_x_axis
//          - div .cr_canvas : the main canvas --> this.canvas
//            - div .cr_progressbar : "please wait" message
//            - div .cr_inner       : regular (non-highlight) tiles go here
//            - div .cr_foreground  : highlight tiles go here
//            - div .cr_grid        : coordinate grids
//            - div .cr_select_area : shows selected area when dragging
//          - div .cr_x_axis : x axis
//        - div .cr_legend : legends and items selection
//          - div .cr_searchbox : search box
//          - div .cr_search_ctrl
//            - input .cr_XXX : search control buttons
//            - button .cr_more : opens the pop-up box
//            - ul .cr_btn_popup : pop-up box
//              - li
//                - a .cr_XXX : "buttons" for selection updates
//          - div .cr_search_stat : "Showing 200 of 3,456 results"
//          - ul .cr_search_result : labels matching the search pattern
//          - div .cr_info : info about what's under the mouse cursor
//    - div id={{canvs_id}}-log : debug logs --> this.log_area
//
// See also display.py for HTML structure.
class Ctxt {
    constructor(canvas_id) {
        this.canvas_id = canvas_id;
        this.canvas_main = document.querySelector('#' + canvas_id);
        this.canvas = document.querySelector(`#${canvas_id} .cr_canvas`);
        this.width = this.height = null;

        // Hmm looks like we can't do this with vanilla JS ...
        // TODO: Check if there's some hook inside Jupyter?
        $('#' + canvas_id).on('remove', () => { this.cleanup_handler(); });

        this.tile_handler = new TileHandler(this);

        this.log_area = $('#' + canvas_id + '-log');
        if (this.log_area) {
            // this.log_area[0].style.backgroundColor = "#dfe";
            this.dbglog('Cell ID = ', canvas_id);
        }

        ctxt_map[canvas_id] = this;

        // Get the current window size and send it as part of the init
        // request.
        css_loaded.then(() => {
            this.width = this.canvas.clientWidth;
            this.height = this.canvas.clientHeight;
            this.dbglog('Initial canvas width/height: ',
                        'w=', this.width, 'h=', this.height);
            console.log('Initial canvas width/height: ',
                        'w=', this.width, 'h=', this.height);
            this.send('cell_init', {'w': this.width, 'h': this.height});

            // Prepare the progress indicator to fire if BE takes too long.
            setTimeout(() => {
                let bar = this.canvas.querySelector('.cr_progressbar');
                if (bar) bar.style.visibility = 'visible';
            }, PROGRESSBAR_TIMEOUT);

            // console.log(
            //     'bounding rect = ', this.canvas[0].getBoundingClientRect());
        })
        .catch(error => { this.fail('Failed to load CSS: ' + error); });
    }

    // Helper function to report failure.
    fail(err) {
        console.log('Failure: ', err)
        this.canvas_main.textContent =
            'Error processing request ' +
            '(see developer console for details): ' + err;
    }

    // Resize handler.
    resize_handler() {
        let width = this.canvas.clientWidth;
        let height = this.canvas.clientHeight;
        if (width != this.width || height != this.height) {
            this.width = width;
            this.height = height;
            this.dbglog(
                'Cell resized to width = ', width, ' height = ', height);
            this.send('resize', {'w': width, 'h': height});
        }
    }

    // Cleanup handler: tell the server that this canvas is gone.
    cleanup_handler() {
        this.send('cell_fini');
        delete ctxt_map[this.canvas_id];
    }

    // Helper function to send a message.
    send(msg, more_data) {
        let data = more_data || {};
        data.msg = msg;
        data.canvas_id = this.canvas_id;
        comm.send(data);
    }

    // Handler for BE message.
    msg_handler(msg_dict, attachments) {
    //  if (attachments.length) {
    //      this.dbglog('BE message with attachment: ', msg_dict,
    //                  'length = ', attachments.map(x => x.byteLength));
    //  }
    //  else {
    //      this.dbglog('BE message received: ', msg_dict);
    //  }

        if (msg_dict.msg == 'new_canvas_config') {
            // For now, we only set the height: width follows the page
            // layout, so `msg_dict.w` must equal the current canvas width.
            if (this.width != msg_dict.w) {
                console.log("Error: width returned from BE doesn't match!");
                // TODO: Now what?
            }
            this.height = msg_dict.h;
            this.canvas.style.height = msg_dict.h + 'px';

            // Add 2px (width of the x axis).
            this.canvas_main.querySelector('.cr_y_axis').style.height =
                (msg_dict.h + 2) + 'px';

            this.tile_handler.register_canvas_config(msg_dict);

            // TODO: Handle msg_dict.x0, y0, x1, y1.
        }
        else if (msg_dict.msg == 'axis_ticks') {
            this.tile_handler.axis_handler.update(msg_dict);
        }
        else if (msg_dict.msg == 'tile') {
            let tile = new Tile(msg_dict, attachments);
            let seqs = msg_dict.seqs.split(':').map(x => parseInt(x));
            // console.log(`Received tile: ${tile.key}`);
            this.tile_handler.register_tile(tile, seqs);
        }
        else if (msg_dict.msg == 'labels') {
            this.tile_handler.update_search_result(msg_dict);
        }
        else {
            console.log('Unknown message', msg_dict)
        }
    }

    // Helper function for debug logging.
    dbglog(...args) {
        if (this.log_area) {
            const s = args.map(
                e => ((typeof(e) == 'object') ? JSON.stringify(e) : e)
            ).join(' ');
            this.log_area.append(document.createTextNode(s), "<br/>");
        }
    }
}

return {
    load_ipython_extension: load_ipython_extension,
    init: init,
    Ctxt: Ctxt
};

//------------------------------------------------

});
