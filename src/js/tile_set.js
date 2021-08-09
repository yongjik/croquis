// Keeps track of the tiles currently being shown in the canvas.

import { tile_key } from './tile.js';
import {
    LRUCache,
    TILE_SIZE
} from './util.js';

const TILE_CACHE_MAXSIZE = 500;

export class TileSet {
    constructor(ctxt) {
        // Canvas is not initialized yet.
        this.width = this.height = null;

        let canvas = document.querySelector(`#${ctxt.canvas_id} .cr_canvas`);
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

        // Currently there are two ways highlight can be triggered: by hovering
        // over the canvas, and hovering over the search result area.  We need
        // to distinguish the two cases, because when the search result is
        // updated, highlight should be updated (currently just cleared) only
        // for the latter case.
        //
        // When highlight is off, this value should be also `null`.
        this.highlight_trigger = null;

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

    // Re-compute which tiles should be visible after config was updated (e.g.,
    // after zoom).
    refresh() {
        for (let tile of this.visible_tiles.values()) {
            // NOTE: This removes `tile` from `visible_tiles` if it's no longer
            // visible.
            if (!this.is_visible(tile)) this.hide_tile(tile);
        }

        for (let [key, tile] of this.tile_cache.d) {
            if (this.is_visible(tile)) {
                this.tile_cache.delete(key);
                this.show_tile(tile);
            }
        }
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
    set_highlight(item_id, trigger_type) {
        this.highlight_item_id = item_id;
        this.highlight_trigger = trigger_type;

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
    // As an optimization, if `existing` is given, we use replaceChild() and
    // insert `existing` into `tile_cache`.  In that case, `existing` should be
    // inside this.visible_tiles when called.
    //
    // TODO: This doesn't seem to be much of an optimization ... remove?
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

        if (!(tile.config_id == this.config_id &&
              tile.zoom_level == this.zoom_level))
            return false;

        const top = tile.row * TILE_SIZE + this.y_offset;
        const left = tile.col * TILE_SIZE + this.x_offset;

        return (top > -TILE_SIZE) && (top < this.height) &&
               (left > -TILE_SIZE) && (left < this.width);
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
