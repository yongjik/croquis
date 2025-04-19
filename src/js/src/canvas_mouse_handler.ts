// Encapsulates mouse interaction inside the canvas.

import type { TileHandler} from './tile_handler';
import { Ctxt } from './ctxt';
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
        ctxt: Ctxt,
        private _parent: TileHandler,
        private _replayer: EventReplayer,
    ) {
        const root: HTMLElement = ctxt.root_node;
        this._canvas = root.querySelector(".cr_canvas") as HTMLElement;
        this._zoom_radio_btn =
            root.querySelector(".cr_zoom") as HTMLInputElement;
        this._select_area = root.querySelector('.cr_select_area')!;

        this.reset();

        for (let evname of ['mousedown', 'mouseleave',
                            'mousemove', 'mouseup']) {
            this._canvas.addEventListener(evname, (_ev: Event) => {
                let ev = _ev as MouseEvent;
                if (this._replayer.status == ReplayStatus.RUNNING) return;

                let rect = this._canvas.getBoundingClientRect();
                this.mouse_x = ev.clientX - rect.left;
                this.mouse_y = ev.clientY - rect.top;
                this.mouse_btns = ev.buttons;

                this.mouse_handler_cb(evname);
            });
        }
    }

    reset(): void {
        this._btn = ButtonStatus.UP;

        // Since this is also called by TileHandler.register_canvas_config(), we
        // want to keep mouse status if it's STOPPED: otherwise highlight
        // handling will be wrong.
        if (this.move != MouseStatus.STOPPED) this.move = MouseStatus.MOVING;

        this._start_x = this._start_y = null;
        this._x_offset0 = this._y_offset0 = null;

        this.clear_select_area();

        // Seems like we don't need this: if mouse is not moving, we want to
        // know about it, even if canvas config changes in the middle.

        // this.clear_mouse_stop_cb();
    }

    replay_mouse_event(args: AnyJson): void {
        this.mouse_x = args.x;
        this.mouse_y = args.y;
        this.mouse_btns = args.btns;
        this.mouse_handler_cb(args.name);
    }

    // `evname`: event name (or 'stopped' if we're called by `mouse_stopped_cb`.
    mouse_handler_cb(evname: string): void {
        const [x, y, btns] = [this.mouse_x, this.mouse_y, this.mouse_btns];
        this._replayer.record_event(
            'mouse', {name: evname, x: x, y: y, btns: btns});
        this._replayer.log(`mouse_handler_cb: status=${this}`);

        if (evname == 'mouseleave') {
            this.move = MouseStatus.OUTSIDE;

            // Mouse is leaving: reset everything.
            this.clear_mouse_stop_cb();
            this.clear_select_area();
            this._parent.clear_highlight();
            this._parent.hide_tooltip();

            return;
        }

        if (evname == 'stopped') {
            this.move = MouseStatus.STOPPED;
            if (this._btn == 'up') {
                this._parent.handle_mouse_stop(x!, y!);
                this._parent.recompute_highlight();
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
        const btn_was_pressed = (this._btn != 'up');
        const btn_is_pressed = ((btns! & 1) == 1);

        let tile_set = this._parent.tile_set;

        // Handle mouse button down transition.
        if (evname == 'mousedown' && !btn_was_pressed && btn_is_pressed) {
            this._parent.clear_highlight();
            this._parent.hide_tooltip();
            this._start_x = x;
            this._start_y = y;

            if (this._zoom_radio_btn.checked) {
                // XXX This seems a bug in the original code?  We were using
                // both "zoom" and "select" to mean the same thing ???
                // this.btn = 'select';
                this._btn = ButtonStatus.SELECT_TO_ZOOM;
            }
            else {
                this._btn = ButtonStatus.PAN;
                this._x_offset0 = tile_set.x_offset;
                this._y_offset0 = tile_set.y_offset;
            }

            return;
        }

        // Handle mouse button up transition.  We also check if `prev_move`
        // is 'outside': this indicates that we pressed the button (entering
        // 'select' or 'pan' state), and then moved the cursor outside of
        // the canvas, and then released the button outside, and then came
        // back.  In that case, we just reset the state and do nothing.
        if (btn_was_pressed && !btn_is_pressed) {
            if (this._btn == ButtonStatus.SELECT_TO_ZOOM && prev_move != 'outside') {
                let diag_len = Math.sqrt(sqr(this._start_x! - x) +
                                         sqr(this._start_y! - y));
                if (diag_len < MIN_SELECT_AREA_DIAG) {
                    this._replayer.log(
                        'Selected area too small, ignoring ...');
                }
                else {
                    const zoom = {
                        px0: this._start_x! - tile_set.x_offset,
                        py0: this._start_y! - tile_set.y_offset,
                        px1: x - tile_set.x_offset,
                        py1: y - tile_set.y_offset,
                    };
                    this._replayer.log('Sending zoom request:', zoom);
                    tile_set.send_zoom_req(zoom);
                }
            }
            else if (this._btn == 'pan' && prev_move != 'outside') {
                this._parent.handle_panning(
                    this._x_offset0! + x - this._start_x!,
                    this._y_offset0! + y - this._start_y!);
            }

            this.clear_select_area();
            this._btn = ButtonStatus.UP;

            return;
        }

        // Any other case is considered a mouse movement.
        if (this._btn == ButtonStatus.UP) {
            // Update mouse history.
            this._parent.update_mouse_history(x, y);
            this._parent.recompute_highlight();
            this.enqueue_mouse_stop_cb();
        }
        else if (this._btn == ButtonStatus.SELECT_TO_ZOOM) {
            this.show_select_area(x, y);
        }
        else if (this._btn == ButtonStatus.PAN) {
            this._parent.handle_panning(this._x_offset0! + x - this._start_x!,
                                        this._y_offset0! + y - this._start_y!);
        }
        else {
            assert(false);
        }
    }

    // Enqueue "mouse stopped" callback which will be called if the mouse cursor
    // doesn't move for MOUSE_STOP_THRESHOLD_MSEC.
    enqueue_mouse_stop_cb(): void {
        if (this._replayer.status != ReplayStatus.RUNNING) {
            this._mouse_stopped_cb =
                window.setTimeout(() => this.mouse_handler_cb('stopped'),
                           MOUSE_STOP_THRESHOLD_MSEC);
        }
    }

    clear_mouse_stop_cb(): void {
        if (this._mouse_stopped_cb != null) {
            window.clearTimeout(this._mouse_stopped_cb);
            this._mouse_stopped_cb = null;
        }
    }

    // Called when mouse moves while (this.btn == 'zoom').
    show_select_area(x1: number, y1: number): void {
        const [x0, y0] = [this._start_x!, this._start_y!];

        this._select_area.style.visibility = 'visible';
        this._select_area.style.top = Math.min(y0, y1) + 'px';
        this._select_area.style.left = Math.min(x0, x1) + 'px';
        this._select_area.style.width = Math.abs(x0 - x1) + 'px';
        this._select_area.style.height = Math.abs(y0 - y1) + 'px';
    }

    clear_select_area(): void {
        this._select_area.style.visibility = 'hidden';
    }

    toString(): string {
        return this._btn + '-' + this.move;
    }

    private _canvas: HTMLElement;
    private _zoom_radio_btn: HTMLInputElement;
    private _select_area: HTMLElement;
    private _mouse_stopped_cb: number | null = null;

    move: MouseStatus = MouseStatus.MOVING;
    private _btn: ButtonStatus = ButtonStatus.UP;
    // (0.0, 0.0) is obviously not the correct initial state but this will be
    // filled once we get any mouse event, so this should silence typescript
    // warnings.
    mouse_x: number = 0.0;
    mouse_y: number = 0.0;
    mouse_btns: number = 0;

    // Mouse position when we started either "select and zoom" or panning.
    // (When this.btn == UP, this value has no meaning.)
    private _start_x: number | null = null;
    private _start_y: number | null = null;

    // Canvas offset when we started panning.
    private _x_offset0: number | null = null;
    private _y_offset0: number | null = null;
}
