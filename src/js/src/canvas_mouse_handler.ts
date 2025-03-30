// Encapsulates mouse interaction inside the canvas.

import type { TileHandler} from './tile_handler';
import { EventReplayer, ReplayStatus } from './event_replayer';
import { AnyJson } from './types';
import { assert, sqr } from './util';

const MOUSE_STOP_THRESHOLD_MSEC = 30.0;
const MIN_SELECT_AREA_DIAG = 5;  // pixels

export enum MouseStatus {
    STOPPED = "stopped",  // mouse has stopped
    MOVING  = "moving",   // mouse is moving
    OUTSIDE = "outside",  // mouse is outside the canvas
};

export enum ButtonStatus {
    UP   = "up",   // left button not pressed
    SELECT_TO_ZOOM = "select_to_zoom",
                   // left button pressed for "select to zoom"
    PAN  = "pan",  // left button pressed for panning
};

export class CanvasMouseHandler {
    constructor(
        ctxt_id: string,
        parent: TileHandler,
        replayer: EventReplayer,
        canvas: HTMLElement,
    ) {
        this.parent = parent;
        this.replayer = replayer;
        this.canvas = canvas;
        this.zoom_radio_btn =
            document.querySelector(`#${ctxt_id}-zoom`)! as HTMLInputElement;
        this.select_area = this.canvas.querySelector('.cr_select_area')!;

        this.mouse_stopped_cb = null;
        // XXX remove!
        // this.move = 'moving';
        this.reset();

        for (let evname of ['mousedown', 'mouseleave',
                            'mousemove', 'mouseup']) {
            this.canvas.addEventListener(evname, (_ev: Event) => {
                let ev = _ev as MouseEvent;
                if (this.replayer.status == ReplayStatus.RUNNING) return;

                let rect = this.canvas.getBoundingClientRect();
                this.mouse_x = ev.clientX - rect.left;
                this.mouse_y = ev.clientY - rect.top;
                this.mouse_btns = ev.buttons;

                this.mouse_handler_cb(evname);
            });
        }
    }

    reset() {
        this.btn = ButtonStatus.UP;

        // Since this is also called by TileHandler.register_canvas_config(), we
        // want to keep mouse status if it's STOPPED: otherwise highlight
        // handling will be wrong.
        if (this.move != MouseStatus.STOPPED) this.move = MouseStatus.MOVING;

        this.start_x = this.start_y = null;
        this.x_offset0 = this.y_offset0 = null;

        this.clear_select_area();

        // Seems like we don't need this: if mouse is not moving, we want to
        // know about it, even if canvas config changes in the middle.

        // this.clear_mouse_stop_cb();
    }

    replay_mouse_event(args: AnyJson) {
        this.mouse_x = args.x;
        this.mouse_y = args.y;
        this.mouse_btns = args.btns;
        this.mouse_handler_cb(args.name);
    }

    // `evname`: event name (or 'stopped' if we're called by `mouse_stopped_cb`.
    mouse_handler_cb(evname: string) {
        const [x, y, btns] = [this.mouse_x, this.mouse_y, this.mouse_btns];
        this.replayer.record_event(
            'mouse', {name: evname, x: x, y: y, btns: btns});
        this.replayer.log(`mouse_handler_cb: status=${this}`);

        if (evname == 'mouseleave') {
            this.move = MouseStatus.OUTSIDE;

            // Mouse is leaving: reset everything.
            this.clear_mouse_stop_cb();
            this.clear_select_area();
            this.parent.clear_highlight();
            this.parent.hide_tooltip();

            return;
        }

        if (evname == 'stopped') {
            this.move = MouseStatus.STOPPED;
            if (this.btn == 'up') {
                this.parent.handle_mouse_stop(x!, y!);
                this.parent.recompute_highlight();
            }

            return;
        }

        if (evname == 'mousemove') this.clear_mouse_stop_cb();

        // Now `evname` is one of mousedown/mousemove/moseup: for that to
        // happen, the cursor must be inside.
        const prev_move = this.move;
        if (this.move == MouseStatus.OUTSIDE) this.move = MouseStatus.MOVING;

        // Since mousedown/mouseup events can trigger for other buttons we don't
        // care about, let's just compare the previous and current state of the
        // primary (= "left") button and use that to decide next action.
        const btn_was_pressed = (this.btn != 'up');
        const btn_is_pressed = ((btns! & 1) == 1);

        let tile_set = this.parent.tile_set;

        // Handle mouse button down transition.
        if (evname == 'mousedown' && !btn_was_pressed && btn_is_pressed) {
            this.parent.clear_highlight();
            this.parent.hide_tooltip();
            this.start_x = x;
            this.start_y = y;

            if (this.zoom_radio_btn.checked) {
                // XXX This seems a bug in the original code?  We were using
                // both "zoom" and "select" to mean the same thing ???
                // this.btn = 'select';
                this.btn = ButtonStatus.SELECT_TO_ZOOM;
            }
            else {
                this.btn = ButtonStatus.PAN;
                this.x_offset0 = tile_set.x_offset;
                this.y_offset0 = tile_set.y_offset;
            }

            return;
        }

        // Handle mouse button up transition.  We also check if `prev_move`
        // is 'outside': this indicates that we pressed the button (entering
        // 'select' or 'pan' state), and then moved the cursor outside of
        // the canvas, and then released the button outside, and then came
        // back.  In that case, we just reset the state and do nothing.
        if (btn_was_pressed && !btn_is_pressed) {
            if (this.btn == ButtonStatus.SELECT_TO_ZOOM && prev_move != 'outside') {
                let diag_len = Math.sqrt(sqr(this.start_x! - x) +
                                         sqr(this.start_y! - y));
                if (diag_len < MIN_SELECT_AREA_DIAG) {
                    this.replayer.log(
                        'Selected area too small, ignoring ...');
                }
                else {
                    const zoom = {
                        px0: this.start_x! - tile_set.x_offset,
                        py0: this.start_y! - tile_set.y_offset,
                        px1: x - tile_set.x_offset,
                        py1: y - tile_set.y_offset,
                    };
                    this.replayer.log('Sending zoom request:', zoom);
                    tile_set.send_zoom_req(zoom);
                }
            }
            else if (this.btn == 'pan' && prev_move != 'outside') {
                this.parent.handle_panning(
                    this.x_offset0! + x - this.start_x!,
                    this.y_offset0! + y - this.start_y!);
            }

            this.clear_select_area();
            this.btn = ButtonStatus.UP;

            return;
        }

        // Any other case is considered a mouse movement.
        if (this.btn == ButtonStatus.UP) {
            // Update mouse history.
            this.parent.update_mouse_history(x, y);
            this.parent.recompute_highlight();
            this.enqueue_mouse_stop_cb();
        }
        else if (this.btn == ButtonStatus.SELECT_TO_ZOOM) {
            this.show_select_area(x, y);
        }
        else if (this.btn == ButtonStatus.PAN) {
            this.parent.handle_panning(this.x_offset0! + x - this.start_x!,
                                       this.y_offset0! + y - this.start_y!);
        }
        else {
            assert(false);
        }
    }

    // Enqueue "mouse stopped" callback which will be called if the mouse cursor
    // doesn't move for MOUSE_STOP_THRESHOLD_MSEC.
    enqueue_mouse_stop_cb() {
        if (this.replayer.status != ReplayStatus.RUNNING) {
            this.mouse_stopped_cb =
                window.setTimeout(() => this.mouse_handler_cb('stopped'),
                           MOUSE_STOP_THRESHOLD_MSEC);
        }
    }

    clear_mouse_stop_cb() {
        if (this.mouse_stopped_cb) {
            window.clearTimeout(this.mouse_stopped_cb);
            this.mouse_stopped_cb = null;
        }
    }

    // Called when mouse moves while (this.btn == 'zoom').
    show_select_area(x1: number, y1: number) {
        const [x0, y0] = [this.start_x!, this.start_y!];

        this.select_area.style.visibility = 'visible';
        this.select_area.style.top = Math.min(y0, y1) + 'px';
        this.select_area.style.left = Math.min(x0, x1) + 'px';
        this.select_area.style.width = Math.abs(x0 - x1) + 'px';
        this.select_area.style.height = Math.abs(y0 - y1) + 'px';
    }

    clear_select_area() {
        this.select_area.style.visibility = 'hidden';
    }

    toString() {
        return this.btn + '-' + this.move;
    }

    private parent: TileHandler;
    private replayer: EventReplayer;
    private canvas: HTMLElement;

    private zoom_radio_btn: HTMLInputElement;
    private select_area: HTMLElement;
    private mouse_stopped_cb: any = null;  // XXX

    move: MouseStatus = MouseStatus.MOVING;
    private btn: ButtonStatus = ButtonStatus.UP;
    // (0.0, 0.0) is obviously not the correct initial state but this will be
    // filled once we get any mouse event, so this should silence typescript
    // warnings.
    mouse_x: number = 0.0;
    mouse_y: number = 0.0;
    mouse_btns: number = 0;

    // Mouse position when we started either "select and zoom" or panning.
    // (When this.btn == UP, this value has no meaning.)
    private start_x: number | null = null;
    private start_y: number | null = null;

    // Canvas offset when we started panning.
    private x_offset0: number | null = null;
    private y_offset0: number | null = null;
}
