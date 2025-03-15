// The "Context" that is associated with each figure.

import { JSONObject } from '@lumino/coreutils';

import type { CommWrapper } from './index';
import { apply_template } from './template';
import { BufList, Callback } from './types';

// XXX TODO
import { Tile } from './tile'
import { TileHandler } from './tile_handler';
import { PROGRESSBAR_TIMEOUT } from './util';


// Base class for the canvas context.
export abstract class Ctxt {
    constructor(node: HTMLElement, ctxt_id: string,
                get_comm: (callback: Callback) => Promise<CommWrapper>) {
        this._node = node;
        this._ctxt_id = ctxt_id;

        this._comm = get_comm((msg, buf) => { this._callback(msg, buf) });
    }

    dispose() { }

    get comm(): Promise<CommWrapper> {
        return this._comm;
    }

    protected abstract _callback(msg_dict: JSONObject, attachments: BufList): void;

    protected _node: HTMLElement;
    protected _ctxt_id: string;
    protected _comm: Promise<CommWrapper>;
}

class CtxtImpl extends Ctxt {
    constructor(node: HTMLElement, ctxt_id: string,
                get_comm: (callback: Callback) => Promise<CommWrapper>) {
        super(node, ctxt_id, get_comm);

        // XXX okay, I think we don't need "env" any more, index.ts handles that.
        //     Also cleanup_handler() is now dispose()
        //     canvas_id is now _ctxt_id
        //     Hmm now we actually have to build it here ...

        apply_template(node, ctxt_id);

        // TileHandler constructor also builds the inner HTML structure.
        let parent_elem = node.querySelector(".cr_main1");
        parent_elem!.innerHTML = '';
        this._tile_handler = new TileHandler(this, parent_elem);

        this._log_area = node.querySelector(".cr_dbglog");
        if (this._log_area) {
            this.dbglog("Cell ID = ", ctxt_id);
        }

// XXX OK what should I do with this???
/* ------------------------------

        // Pedantic: must be after `this._tile_handler` is initialized, because
        // after this this.resize_handler() may be called, which uses
        // `_tile_handler`.
        env.ctxt_map[canvas_id] = this;

--------------------------------- */

        // Get the current window size and send it as part of the init
        // request.
        this._tile_handler.tile_set.reset_canvas();
        this._tile_handler.search_handler(null);

        // Prepare the progress indicator to fire if BE takes too long.
        setTimeout(() => {
            let bar: HTMLElement | null = node.querySelector("div.cr_progressbar");
            if (bar) bar.style.visibility = "visible";
        }, PROGRESSBAR_TIMEOUT);

        // console.log(
        //     'bounding rect = ', this.canvas[0].getBoundingClientRect());

        // XXX OK it looks like we can now use ResizeObserver, like this:

        /*
            // Select the element to observe
            const observedElement = document.getElementById("myElement");

            // Create a ResizeObserver instance
            const resizeObserver = new ResizeObserver((entries) => {
                for (let entry of entries) {
                    console.log(`Size changed:`, entry.contentRect);
                }
            });

            // Start observing the element
            resizeObserver.observe(observedElement);

            // To stop observing later, you can call:
            // resizeObserver.unobserve(observedElement);
            // resizeObserver.disconnect(); // To stop observing all elements
        */

        // TODO: resize_handler() removed here, should just handle it directly
        // inside TileHandler (.tile_set.resize_canvas())
    }

    // Cleanup handler: tell the server that this canvas is gone.
    dispose() {
        this.send('cell_fini');
        delete this.env.ctxt_map[this._ctxt_id];
    }

    // Helper function to send a message.
    // TODO: Do we need this wrapper?
    send(msg: string, more_data: JSONObject | null): Promise<CommWrapper> {
        let data = more_data || {};
        data.msg = msg;
        return this._comm.send(data);
    }

    // Handler for BE message.
    protected _callback(msg_dict: JSONObject, attachments: BufList): void {
    //  if (attachments.length) {
    //      this.dbglog('BE message with attachment: ', msg_dict,
    //                  'length = ', attachments.map(x => x.byteLength));
    //  }
    //  else {
    //      this.dbglog('BE message received: ', msg_dict);
    //  }

        if (msg_dict.msg == 'canvas_config') {
            this._tile_handler.register_canvas_config(msg_dict);
        }
        else if (msg_dict.msg == 'axis_ticks') {
            this._tile_handler.axis_handler.update(msg_dict);
        }
        else if (msg_dict.msg == 'tile') {
            let tile = new Tile(msg_dict, attachments);
            let seqs = msg_dict.seqs.split(':').map(x => parseInt(x));
            // console.log(`Received tile: ${tile.key}`);
            this._tile_handler.register_tile(tile, seqs);
        }
        else if (msg_dict.msg == 'pt') {
            this._tile_handler.nearest_pts.insert(msg_dict);
            this._tile_handler.recompute_highlight();
        }
        else if (msg_dict.msg == 'labels') {
            this._tile_handler.update_search_result(msg_dict);
        }
        else {
            console.log('Unknown message', msg_dict)
        }
    }

    // Helper function for debug logging.
    dbglog(...args) {
        if (this._log_area) {
            const s = args.map(
                e => ((typeof(e) == 'object') ? JSON.stringify(e) : e)
            ).join(' ');
            this._log_area.append(document.createTextNode(s), "<br/>");
        }
    }

    private _log_area: HTMLElement | null;
    private _tile_handler: TileHandler;
}
