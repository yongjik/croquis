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

        // Hmm looks like we can't do this with vanilla JS ...
        // TODO: Check if there's some hook inside Jupyter?
        env.$('#' + canvas_id).on('remove', () => { this.cleanup_handler(); });

        // TileHandler constructor also builds the inner HTML structure.
        let parent_elem = document.querySelector(`#${canvas_id} .cr_main1`);
        parent_elem.innerHTML = '';
        this.tile_handler = new TileHandler(this, parent_elem);

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
            this.tile_handler.tile_set.reset_canvas();
            this.tile_handler.search_handler(null);

            // Prepare the progress indicator to fire if BE takes too long.
            setTimeout(() => {
                let bar = this.get_canvas().querySelector('.cr_progressbar');
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

    // Called when the window size *may* have changed: see the discussion on
    // window_setInterval() inside croquis_loader.js.
    resize_handler() {
        this.tile_handler.tile_set.resize_canvas();
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

        if (msg_dict.msg == 'canvas_config') {
            this.tile_handler.register_canvas_config(msg_dict);
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

    // Internal helper function, because now `canvas` is dynamically generated.
    // TODO: Doesn't belong here, refactor!
    get_canvas() {
        return document.querySelector(`#${this.canvas_id} .cr_canvas`);
    }
}
