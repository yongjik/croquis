// The tile itself.

import { AnyJson, BufList } from './types';
import { TILE_SIZE } from './util';

// A tile key does not contain `sm_version` because we want to use the latest
// available version even if the "correct" (latest requested) version is not
// available yet.
export function tile_key(
    config_id: number, zoom_level: number,
    row: number, col: number,
    item_id: number | null = null,
): string {
    if (item_id == null)
        return `${config_id}:${zoom_level}:${row}:${col}`;
    else
        return `${config_id}:${zoom_level}:${row}:${col}:${item_id}`;
}

export class Tile {
    constructor(msg_dict: AnyJson, attachments: BufList) {
        const is_hover = 'item_id' in msg_dict;

        this.sm_version = msg_dict.sm_version;  // Selection map version.
        this.config_id = msg_dict.config_id;
        this.zoom_level = msg_dict.zoom_level;
        this.row = msg_dict.row;
        this.col = msg_dict.col;
        if (is_hover) {
            this.item_id = msg_dict.item_id;
            this.label = msg_dict.label;
            this.style = msg_dict.style;
        }

        this.key = tile_key(this.config_id, this.zoom_level,
                            this.row, this.col, this.item_id);

        const png_data = attachments[0];
        this.elem = new Image(TILE_SIZE, TILE_SIZE);
        this.elem.classList.add('cr_tile');
        this.elem.setAttribute('draggable', 'false');
        this.elem.src = URL.createObjectURL(
            new Blob([png_data], {type: 'image/png'}));

        // Hovermap data is available only if this is *not* a hover (i.e.,
        // highlight) image.
        if (!is_hover) {
            this.hovermap = (attachments[1] instanceof ArrayBuffer)
                ? new DataView(attachments[1])
                : attachments[1] as DataView;
        }
    }

    is_hover() {
        return this.item_id != null;
    }

    sm_version: number;
    config_id: number;
    zoom_level: number;
    row: number;
    col: number;

    item_id: number | null = null;
    // XXX TODO: crosscheck with label.ts
    label: string | null = null;
    style: string | null = null;

    key: string;
    elem: HTMLImageElement;
    hovermap: DataView | null = null;
}
