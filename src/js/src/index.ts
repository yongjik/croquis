// The main entry point of the croquis module.
//
// Partially copied from these sources:
//      https://github.com/jupyterlab/extension-examples/tree/main/mimerenderer
//      https://jupyterlab.readthedocs.io/en/stable/extension/extension_tutorial.html

import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Kernel } from '@jupyterlab/services';
import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { JSONObject, ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';
import { ICommMsgMsg } from '@jupyterlab/services/lib/kernel/messages';

import { BaseCtxt, Ctxt } from './ctxt';
import { Callback } from './types';

// Mime type used for this extension.
// Must match //src/croquis/display.py
const MIME_TYPE = 'application/vnd.croquis+json';

// Public API for BE communication: created by KernelEntry.get_comm().
export class CommWrapper {
    constructor(parent: KernelEntry, ctxt_id: string) {
        this._parent = parent;
        this._ctxt_id = ctxt_id;
    }

    send(msg: JSONObject): Promise<CommWrapper> {
        if (this._parent._raw_comm) {
            msg.ctxt_id = this._ctxt_id;
            this._parent._raw_comm.send(msg);
            return Promise.resolve(this);
        } else {
            return Promise.reject("comm is closed!");
        }
    }

    private _parent: KernelEntry;
    private _ctxt_id: string;
}

// Holds data for one backend kernel and its connection.
// (I don't even know how one connects to multiple kernels from a single page,
// but the jupyter API is structured in such a way that assumes multiple
// kernels, so might be better to play along.)
class KernelEntry {
    constructor(kernel_id: string, kernel: Kernel.IKernelConnection) {
        this.kernel_id = kernel_id;
        this.kernel = kernel;
    }

    private _ensure_comm_open(BE_id: string): Promise<void> {
        if (this.BE_id != BE_id) {
            if (this.BE_id != null) {
                console.log(
                    `BE_id changed from ${this.BE_id} to ${BE_id}: ` +
                    `re-opening comm ...`
                );
            }
            else
                console.log(`Opening comm: ${BE_id}`);

            if (this._BE_ready) {
                this._BE_ready_reject?.();
                this._BE_ready = null;
                this._BE_ready_resolve = null;
                this._BE_ready_reject = null;
            }

            this.BE_id = BE_id;
            this._BE_ready = new Promise((resolve, reject) => {
                this._BE_ready_resolve = resolve;
                this._BE_ready_reject = reject;
            });

            this._raw_comm = this.kernel.createComm("croquis");
            this._raw_comm.onMsg = (msg) => { this._msg_dispatcher(msg) };
            this._raw_comm.open({"msg": "FE_loaded"});
        }

        return this._BE_ready ?? Promise.reject("Cannot happen!");
    }

    // Routes websocket message received from BE.
    private _msg_dispatcher(msg: ICommMsgMsg): void {
        const data: JSONObject = msg.content.data;

        if (data.msg == "BE_ready") {
            console.log("Backend is ready!");
            this._BE_ready_resolve?.();
            this._BE_ready_resolve = null;
            this._BE_ready_reject = null;
            return;
        }

        const ctxt_id = data.ctxt_id as string;
        const callback = this._ctxt_map.get(ctxt_id);
        if (callback) {
            callback(data, msg.buffers || []);
        } else {
            console.log('Unknown context ID: ', ctxt_id);
        }
    }

    get_comm(BE_id: string, ctxt_id: string, callback: Callback)
        : Promise<CommWrapper> {

        this._ctxt_map.set(ctxt_id, callback);
        return this._ensure_comm_open(BE_id).then(
                   () => new CommWrapper(this, ctxt_id));
    }

    kernel_id: string;
    kernel: Kernel.IKernelConnection;
    _raw_comm: Kernel.IComm | null = null;  // used by CommWrapper.
    BE_id: string | null = null;
    private _BE_ready: Promise<void> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _BE_ready_resolve: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _BE_ready_reject: any = null;
    private _ctxt_map: Map<string, Callback> = new Map();
}

// Logic copied from ipywidgets/python/jupyterlab_widgets/src/plugin.ts
// This is a singleton, instantiated inside plugin.activate.
class KernelRegistry {
    constructor(tracker: INotebookTracker) {
        tracker.forEach(async (panel) => { this.register(panel); });
        tracker.widgetAdded.connect(async (_, panel) => {
            this.register(panel);
        });
    }

    private async register(panel: NotebookPanel) {
        const sessionContext = panel.context.sessionContext;
        await sessionContext.ready;

        const kernel = sessionContext.session?.kernel;
        const kernel_id: string | undefined = kernel?.id;
        console.log(`kernel id = ${kernel_id}`);
        if (kernel && kernel_id != undefined) {
            this._kernels.set(kernel_id, new KernelEntry(kernel_id, kernel));
        }
    }

    get_comm(kernel_id: string, BE_id: string,
             ctxt_id: string, callback: Callback): Promise<CommWrapper> {
        // do we have kernel_id in _kernels?
        const entry = this._kernels.get(kernel_id);
        if (entry) {
            return entry.get_comm(BE_id, ctxt_id, callback);
        } else {
            return Promise.reject("Cannot find kernel!");
        }
    }

    private _kernels: Map<string, KernelEntry> = new Map();
}

export class CroquisWidget extends Widget implements IRenderMime.IRenderer {
    constructor(
        app: JupyterFrontEnd,
        registry: KernelRegistry,
        options: IRenderMime.IRendererOptions
    ) {
        super();
        console.log("options = ", options);
        this._registry = registry;
    }

    dispose() {
        console.log(`dispose called for: ${this._ctxt_id}`);
        this._ctxt?.dispose();
        super.dispose();
    }

    renderModel(model: IRenderMime.IMimeModel): Promise<void> {
        const val1 = model.data?.[MIME_TYPE] as ReadonlyPartialJSONObject;
        const kernel_id = val1?.["kernel_id"] as string;
        const BE_id = val1?.["BE_id"] as string;
        const ctxt_id = val1?.["ctxt_id"] as string;
        this._ctxt_id = ctxt_id;

        console.log(
            `renderModel called!  kernel_id=${kernel_id} BE_id=${BE_id} ` +
            `ctxt_id=${ctxt_id}`
        );

        if (ctxt_id === null) {
            return Promise.reject("no ctxt id!");
        }

        this._ctxt = new Ctxt(
            this.node, ctxt_id,
            (callback) => this._registry.get_comm(
                kernel_id, BE_id, ctxt_id, callback)
        );

        return this._ctxt.comm.then(() => {});
    }

    private _registry: KernelRegistry;
    private _ctxt_id: string | null = null;
    private _ctxt: BaseCtxt | null = null;
}

const plugin: JupyterFrontEndPlugin<void> = {
    id: 'croquis-js',
    description: 'Frontend plugin for croquis.',
    autoStart: true,
    requires: [
        IRenderMimeRegistry,
        INotebookTracker,
    ],
    activate: async (
        app: JupyterFrontEnd,
        rendermime: IRenderMimeRegistry,
        tracker: INotebookTracker
    ) => {
        const registry = new KernelRegistry(tracker);
        const rank = 0;
        const rendererFactory: IRenderMime.IRendererFactory = {
            safe: true,
            mimeTypes: [MIME_TYPE],
            createRenderer: options => new CroquisWidget(app, registry, options),
        };

        // Copied from createRendermimePlugin in @jupyterlab/application.
        rendermime.addFactory(rendererFactory, rank);

        console.log("Finished rendermime.AddFactory!");
    }
};

console.log("croquis extension loaded !!!");

export default plugin;
