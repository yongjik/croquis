// The "Context" that is associated with each figure.

import { Tile } from './tile.js'
import { TileHandler } from './tile_handler.js';
import { PROGRESSBAR_TIMEOUT } from './util.js';

// Current setup:
//  - div #croquis_nbext : outermost container
//    - div #{{canvas_id}}-btns : buttons for debugging
//    - div #{{canvas_id}} .cr_main : the whole area including axes
//      - div .cr_ctrl_panel : "Control panel" at the top.
//        - span .cr_ctrl_btns
//          - button .cr_home_btn     : home (reset) button
//          - button .cr_zoom_in_btn  : zoom in
//          - button .cr_zoom_out_btn : zoom out
//        - input #{{canvas_id}}-zoom : "drag mouse to zoom"
//        - input #{{canvas_id}}-pan  : "drag mouse to pan"
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
//          - div .cr_tooltip : tooltip (activates when mouse stops)
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
//          // Currently commented out:
//          // - div .cr_info : info about what's under the mouse cursor
//    - div id={{canvs_id}}-log : debug logs --> this.log_area
//
// See also display.py for HTML structure.
export class Ctxt {
    constructor(env, canvas_id) {
        this.env = env;
        this.canvas_id = canvas_id;
        this.canvas_main = document.querySelector('#' + canvas_id);
        this.canvas = document.querySelector(`#${canvas_id} .cr_canvas`);

        // TODO: This is confusing, as we also have TileSet.width/height.
        //       Currently, Ctxt.width/height is updated when we *send* resize
        //       request to BE; TileSet.width/height is updated when we get back
        //       the `new_canvas_config` message.
        //
        //       We need a better way to handle window resize ...
        this.width = this.height = null;

        // Hmm looks like we can't do this with vanilla JS ...
        // TODO: Check if there's some hook inside Jupyter?
        env.$('#' + canvas_id).on('remove', () => { this.cleanup_handler(); });

        this.tile_handler = new TileHandler(this);

        this.log_area = env.$('#' + canvas_id + '-log');
        if (this.log_area) {
            // this.log_area[0].style.backgroundColor = "#dfe";
            this.dbglog('Cell ID = ', canvas_id);
        }

        // Pedantic: must be after `this.tile_handler` is initialized, because
        // after this this.resize_handler() may be called, which uses
        // `tile_handler`.
        env.ctxt_map[canvas_id] = this;

        // Get the current window size and send it as part of the init
        // request.
        env.css_loaded.then(() => {
            this.width = this.canvas.clientWidth;
            this.height = this.canvas.clientHeight;
            this.dbglog('Initial canvas width/height: ',
                        'w=', this.width, 'h=', this.height);
            console.log('Initial canvas width/height: ',
                        'w=', this.width, 'h=', this.height);

            this.send('resize', {'w': this.width, 'h': this.height});
            this.tile_handler.search_handler(null);

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

    // Called when the window size *may* have changed: see the discussion at the
    // top of this file about window.setInterval().
    resize_handler() {
        let width = this.canvas.clientWidth;
        let height = this.canvas.clientHeight;

        // Let's only consider the width for now: the height is adjusted
        // according to the width.
        // TODO: Add support for dynamically updating canvas size?
        if (width == this.width) return;

        this.width = width;
        this.height = height;

        let msg = {w: width, h: height};

        let tile_set = this.tile_handler.tile_set;
        if (tile_set.config_id != null) {
            msg.config_id = tile_set.config_id;
            msg.zoom_level = tile_set.zoom_level;
            msg.x_offset = tile_set.x_offset;
            msg.y_offset = tile_set.y_offset;
        }

        this.dbglog('Cell resized to width = ', width, ' height = ', height);
        this.send('resize', msg);
    }

    // Cleanup handler: tell the server that this canvas is gone.
    cleanup_handler() {
        this.send('cell_fini');
        delete this.env.ctxt_map[this.canvas_id];
    }

    // Helper function to send a message.
    send(msg, more_data) {
        let data = more_data || {};
        data.msg = msg;
        data.canvas_id = this.canvas_id;
        // console.log(`${get_timestamp_str()} sending msg: `, msg, more_data);
        this.env.send_msg(data);
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
            // layout, so `msg_dict.w` must equal the current canvas width,
            // unless the user is continuously resizing the window.
            if (this.width != msg_dict.w) {
                console.log("Warning: width returned from BE doesn't match!");
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
        else if (msg_dict.msg == 'pt') {
            this.tile_handler.nearest_pts.insert(msg_dict);
            this.tile_handler.recompute_highlight();
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
