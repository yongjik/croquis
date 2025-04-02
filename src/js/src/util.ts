// Miscellaneous constants and utility functions.

export const PROGRESSBAR_TIMEOUT = 500;  // ms
export const TILE_SIZE = 256;
export const ZOOM_FACTOR = 1.5;  // Must match constants.h.
export const ITEM_ID_SENTINEL = Number.MAX_SAFE_INTEGER;  // Used by Label.
export const INFLIGHT_REQ_EXPIRE_MSEC = 5000;

export enum HighlightType {
    VIA_CANVAS = "canvas",
    VIA_SEARCH = "search",
}

// TODO: Any way to generate a better assert message?
export function assert(x: boolean, msg: string | null = null) {
    if (!x) {
        throw (msg) ? msg : "Should not happen!";
    }
}

export function assertFalse(msg: string | null = null): never {
    throw (msg) ? msg : "Should not happen!";
}

export function sqr(x: number): number { return x * x; }

// Current time as string HH:MM:SS.mmm, for debug logging.
export function get_timestamp_str(): string {
    let T = new Date();
    let fmt = (x: number, sz: number) => x.toString().padStart(sz, "0");
    return fmt(T.getHours(), 2) + ':' + fmt(T.getMinutes(), 2) + ':' +
           fmt(T.getSeconds(), 2) + '.' + fmt(T.getMilliseconds(), 3);
}

// Helper function to hide/unhide stuff by changing "display" attribute.
// (We assume that CSS did not set "display: none": in that case unhide() will
// not work.)
export function hide(elem: HTMLElement) { elem.style.display = "none"; }
export function unhide(elem: HTMLElement) { elem.style.display = ""; }

// Utility class for managing a popup box that closes itself when the user
// clicks somewhere else.
// cf. https://stackoverflow.com/a/3028037
export class PopupBox {
    constructor(target: HTMLElement) {
        this._target = target;
        this._target.style.visibility = 'hidden';
        this._listener = null;
    }

    show(): void {
        this._target.style.visibility = 'visible';
        if (this._listener != null)
            document.removeEventListener('click', this._listener);

        this._listener = (ev: MouseEvent): void => {
            if (!this._target.contains(ev.target as Node)) this.hide();
        };
        window.setTimeout(() => {
            if (this._listener) {
                document.addEventListener('click', this._listener);
            }
        }, 0);
    }

    hide(): void {
        this._target.style.visibility = 'hidden';
        if (this._listener != null) {
            document.removeEventListener('click', this._listener);
            this._listener = null;
        }
    }

    private _target: HTMLElement;
    private _listener: ((ev: MouseEvent) => void) | null;
}

// Utility class for LRU cache.
export class LRUCache<K, V> {
    constructor(maxsize: number, should_replace: (oldv: V, newv: V) => boolean) {
        this._maxsize = maxsize;
        this._should_replace = should_replace;
        this._d = new Map();
    }

    clear(): void { this._d.clear(); }
    delete(key: K): boolean { return this._d.delete(key); }
    get(key: K): V | null { return this._d.get(key) ?? null; }
    has(key: K): boolean { return this._d.has(key); }
    size(): number { return this._d.size; }

    // Insert key/value pair: if the same key already exists, we call
    // should_replace(old item, new item), and replaces the old item iff it
    // returns true.
    insert(key: K, value: V): void {
        let old = this.get(key);
        if (old != undefined && !this._should_replace(old, value))
            return;

        this._d.delete(key);
        while (this._d.size >= this._maxsize) {
            // delete the first key in the map.
            this._d.delete(this._d.keys().next().value as K);            
        }
        this._d.set(key, value);
    }

    pop(key: K): V | null {
        let v = this._d.get(key);
        if (v == undefined) return null;
        this._d.delete(key);
        return v;
    }

    get d(): Map<K, V> { return this._d; }

    private _maxsize: number;
    private _should_replace: (oldv: V, newv: V) => boolean;
    private _d: Map<K, V>;
}
