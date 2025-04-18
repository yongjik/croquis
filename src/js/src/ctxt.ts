// The "Context" that is associated with each figure.

import type { CommWrapper } from './index';
import { apply_template } from './template';
import { AnyJson, BufList, Callback } from './types';

import { Tile } from './tile'
import { TileHandler } from './tile_handler';

// Base class for the canvas context.
// To minimize coupling betweein Jupyter notebook and our code, index.ts only
// depends on BaseCtxt and not Ctxt.
export abstract class BaseCtxt {
    constructor(
        protected _root_node: HTMLElement,
        protected _ctxt_id: string,
        get_comm: (callback: Callback) => Promise<CommWrapper>
    ) {
        this._comm = get_comm((msg, buf) => { this._callback(msg, buf) });
    }

    dispose() { }

    get root_node(): HTMLElement {
        return this._root_node;
    }

    get ctxt_id(): string {
        return this._ctxt_id;
    }

    get comm(): Promise<CommWrapper> {
        return this._comm;
    }

    protected abstract _callback(msg_dict: AnyJson, attachments: BufList): void;

    protected _comm: Promise<CommWrapper>;
}

export class Ctxt extends BaseCtxt {
    constructor(node: HTMLElement, ctxt_id: string,
                get_comm: (callback: Callback) => Promise<CommWrapper>) {
        super(node, ctxt_id, get_comm);

        // XXX okay, I think we don't need "env" any more, index.ts handles that.
        //     Also cleanup_handler() is now dispose()
        //     canvas_id is now _ctxt_id
        //     Hmm now we actually have to build it here ...

        apply_template(node, ctxt_id);

        // TileHandler constructor also builds the inner HTML structure.
        this._tile_handler = new TileHandler(this);

        this._log_area = node.querySelector(".cr_dbglog");
        if (this._log_area) {
            this.dbglog("Cell ID = ", ctxt_id);
        }
    }

    // Cleanup handler: tell the server that this canvas is gone.
    dispose() {
        this.send('cell_fini');
        this._tile_handler.cleanup();
    }

    // Helper function to send a message.
    // TODO: Do we need this wrapper?
    send(msg: string, more_data?: AnyJson) {
        let data: AnyJson = more_data || {};
        data.msg = msg;
        this._comm.then(
            (comm) => comm.send(data)
        ).catch(
            (err) => this._tile_handler.status_bar.on_comm_error(err)
        );
    }

    // Handler for BE message.
    protected _callback(msg_dict: AnyJson, attachments: BufList): void {
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
            let seqs = msg_dict.seqs.split(':').map((x: string) => parseInt(x));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbglog(...args: any[]) {
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
