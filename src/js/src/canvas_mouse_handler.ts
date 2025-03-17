// Encapsulates mouse interaction inside the canvas.

import type { TileHandler} from './tile_handler';
import { ReplayStatus } from './event_replayer';
import { assert, sqr } from './util';

const MOUSE_STOP_THRESHOLD_MSEC = 30.0;
const MIN_SELECT_AREA_DIAG = 5;  // pixels

export enum MouseStatus {
    STOPPED = "stopped",
    MOVING = "moving",
    OUTSIDE = "outside",
};

export class CanvasMouseHandler {
    constructor(
        parent: TileHandler, replayer: EventReplayer, canvas: HTMLElement,
    ) {
        this.parent = parent;
        this.replayer = replayer;
        this.canvas = canvas;
        this.zoom_radio_btn =
            document.querySelector(`#${parent.ctxt.canvas_id}-zoom`);
        this.select_area = this.canvas.querySelector('.cr_select_area');

        this.mouse_stopped_cb = null;
        // XXX remove!
        // this.move = 'moving';
        this.reset();

        this.mouse_x = null;
        this.mouse_y = null;
        this.mouse_btns = 0;

        for (let evname of ['mousedown', 'mouseleave',
                            'mousemove', 'mouseup']) {
            this.canvas.addEventListener(evname, (ev) => {
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
        // Button state: up (left button not pressed)
        //               zoom (left button pressed for "select to zoom")
        //               pan (left button pressed for panning)
        this.btn = 'up';

        // Movement state: moving (mouse is moving)
        //                 stopped (mouse has stopped)
        //                 outside (mouse is outside the canvas)
        //
        // Since this is also called by TileHandler.register_canvas_config(), we
        // want to keep mouse status if it's 'stopped': otherwise highlight
        // handling will be wrong.
        if (this.move != 'stopped') this.move = 'moving';

        // Mouse position when we started either "select and zoom" or panning.
        // (When this.btn == 'up', this value has no meaning.)
        this.start_x = this.start_y = null;

        // Canvas offset when we started panning.
        this.x_offset0 = this.y_offset0 = null;

        this.clear_select_area();

        // Seems like we don't need this: if mouse is not moving, we want to
        // know about it, even if canvas config changes in the middle.

        // this.clear_mouse_stop_cb();
    }

    replay_mouse_event(args) {
        this.mouse_x = args.x;
        this.mouse_y = args.y;
        this.mouse_btns = args.btns;
        this.mouse_handler_cb(args.name);
    }

    // `evname`: event name (or 'stopped' if we're called by `mouse_stopped_cb`.
    mouse_handler_cb(evname) {
        const [x, y, btns] = [this.mouse_x, this.mouse_y, this.mouse_btns];
        this.replayer.record_event(
            'mouse', {name: evname, x: x, y: y, btns: btns});
        this.replayer.log(`mouse_handler_cb: status=${this}`);

        if (evname == 'mouseleave') {
            this.move = 'outside';

            // Mouse is leaving: reset everything.
            this.clear_mouse_stop_cb();
            this.clear_select_area();
            this.parent.clear_highlight();
            this.parent.hide_tooltip();

            return;
        }

        if (evname == 'stopped') {
            this.move = 'stopped';
            if (this.btn == 'up') {
                this.parent.handle_mouse_stop(x, y);
                this.parent.recompute_highlight();
            }

            return;
        }

        if (evname == 'mousemove') this.clear_mouse_stop_cb();

        // Now `evname` is one of mousedown/mousemove/moseup: for that to
        // happen, the cursor must be inside.
        const prev_move = this.move;
        if (this.move == 'outside') this.move = 'moving';

        // Since mousedown/mouseup events can trigger for other buttons we don't
        // care about, let's just compare the previous and current state of the
        // primary (= "left") button and use that to decide next action.
        const btn_was_pressed = (this.btn != 'up');
        const btn_is_pressed = ((btns & 1) == 1);

        let tile_set = this.parent.tile_set;

        // Handle mouse button down transition.
        if (evname == 'mousedown' && !btn_was_pressed && btn_is_pressed) {
            this.parent.clear_highlight();
            this.parent.hide_tooltip();
            this.start_x = x;
            this.start_y = y;

            if (this.zoom_radio_btn.checked) {
                this.btn = 'select';
            }
            else {
                this.btn = 'pan';
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
            if (this.btn == 'select' && prev_move != 'outside') {
                let diag_len = Math.sqrt(sqr(this.start_x - x) +
                                         sqr(this.start_y - y));
                if (diag_len < MIN_SELECT_AREA_DIAG) {
                    this.replayer.log(
                        'Selected area too small, ignoring ...');
                }
                else {
                    const zoom = {
                        px0: this.start_x - tile_set.x_offset,
                        py0: this.start_y - tile_set.y_offset,
                        px1: x - tile_set.x_offset,
                        py1: y - tile_set.y_offset,
                    };
                    this.replayer.log('Sending zoom request:', zoom);
                    tile_set.send_zoom_req(zoom);
                }
            }
            else if (this.btn == 'pan' && prev_move != 'outside') {
                this.parent.handle_panning(
                    this.x_offset0 + x - this.start_x,
                    this.y_offset0 + y - this.start_y);
            }

            this.clear_select_area();
            this.btn = 'up';

            return;
        }

        // Any other case is considered a mouse movement.
        if (this.btn == 'up') {
            // Update mouse history.
            this.parent.update_mouse_history(x, y);
            this.parent.recompute_highlight();
            this.enqueue_mouse_stop_cb();
        }
        else if (this.btn == 'select') {
            this.show_select_area(x, y);
        }
        else if (this.btn == 'pan') {
            this.parent.handle_panning(this.x_offset0 + x - this.start_x,
                                       this.y_offset0 + y - this.start_y);
        }
        else {
            assert(null);
        }
    }

    // Enqueue "mouse stopped" callback which will be called if the mouse cursor
    // doesn't move for MOUSE_STOP_THRESHOLD_MSEC.
    enqueue_mouse_stop_cb() {
        if (this.replayer.status != ReplayStatus.RUNNING) {
            this.mouse_stopped_cb =
                setTimeout(() => this.mouse_handler_cb('stopped'),
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
    show_select_area(x1, y1) {
        const [x0, y0] = [this.start_x, this.start_y];

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

    private zoom_radio_btn: HTMLElement;
    private select_area: HTMLElement;
    private mouse_stopped_cb: any = null;  // XXX
    move: MouseStatus = MouseStatus.MOVING;
}
