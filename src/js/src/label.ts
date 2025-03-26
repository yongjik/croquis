// A label shown in the legend (search result) section.

import { ITEM_ID_SENTINEL } from './util.js';

const LABEL_SVG_WIDTH = 40;  // px
const LABEL_SVG_HEIGHT = 8;  // px
const LABEL_MARKER_SIZE_MAX = 8;  // px
const LABEL_LINE_WIDTH_MAX = 5;  // px

export class Label {
    // See message "labels" in //src/doc/messages.txt
    constructor(
        item_id: number, selected: boolean, label: string, style: string,
        cb
    ) {
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

        this.highlighted = false;

        let cb2 = (ev) => cb(this, ev);
        this.elem.addEventListener('mouseenter', cb2);
        this.elem.addEventListener('mousemove', cb2);
        this.elem.addEventListener('mouseleave', cb2);
    }

    // `selected` is boolean.
    update_selected(selected) {
        if (this.item_id == ITEM_ID_SENTINEL) return;
        this.selected = selected;
        this.checkbox.checked = selected;
        if (selected == false) this.update_highlight(false);
    }

    // `highlighted` is boolean.
    update_highlight(highlighted) {
        if (this.item_id == ITEM_ID_SENTINEL) return;

        if (highlighted && !this.highlighted) {
            this.highlighted = true;
            this.elem.classList.add('highlighted');
        }
        else if (!highlighted && this.highlighted) {
            this.highlighted = false;
            this.elem.classList.remove('highlighted');
        }
    }

    clear_highlight() {
        if (this.item_id == ITEM_ID_SENTINEL) return;
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

    item_id: number;
    private elem: HTMLElement;
    checkbox: HTMLInputElement;
}
