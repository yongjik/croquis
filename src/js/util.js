// Miscellaneous constants and utility functions.

export const PROGRESSBAR_TIMEOUT = 500;  // ms
export const TILE_SIZE = 256;
export const ZOOM_FACTOR = 1.5;  // Must match constants.h.
export const ITEM_ID_SENTINEL = Number.MAX_SAFE_INTEGER;  // Used by Label.
export const INFLIGHT_REQ_EXPIRE_MSEC = 5000;

export function sqr(x) { return x * x; }

// Current time as string HH:MM:SS.mmm, for debug logging.
export function get_timestamp_str() {
    let T = new Date();
    let fmt = (x, sz) => ('000' + x).slice(-sz);  // Seriously, no printf??
    return fmt(T.getHours(), 2) + ':' + fmt(T.getMinutes(), 2) + ':' +
           fmt(T.getSeconds(), 2) + '.' + fmt(T.getMilliseconds(), 3);
}

// Helper function to hide/unhide stuff by changing "display" attribute.
// (We assume that CSS did not set "display: none": in that case unhide() will
// not work.)
export function hide(elem) { elem.style.display = 'none'; }
export function unhide(elem) { elem.style.display = null; }

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
export class PopupBox {
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

// Utility class for LRU cache.
export class LRUCache {
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
