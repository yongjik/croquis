const PROGRESSBAR_TIMEOUT = 500;  // ms

enum GraphStatus {
    INITIAL = "initial",  // initializing
    ERROR   = "error",    // cannot connect to the backend
    OK      = "ok",
}

export class StatusBar {
    constructor(private _bar: HTMLElement) {
        // Prepare the progress indicator to fire if BE takes too long.
        this._show_progressbar_cb = window.setTimeout(() => {
            this._bar.innerHTML =
                "Please wait, the graph is being generated ...";
            this._bar.style.visibility = "visible";
        }, PROGRESSBAR_TIMEOUT);
    }

    on_comm_error(_err: string): void {
        this.clear_cb();
        this._status = GraphStatus.ERROR;
        this._bar.innerHTML =
            "Cannot connect to backend!  Please rerun the cell.";
        this._bar.style.visibility = "visible";
    }

    on_comm_ok(): void {
        this.clear_cb();
        this._status = GraphStatus.OK;
        this._bar.style.visibility = "hidden";
    }

    private clear_cb(): void {
        if (this._show_progressbar_cb != null) {
            window.clearTimeout(this._show_progressbar_cb);
            this._show_progressbar_cb = null;
        }

    }

    private _status: GraphStatus = GraphStatus.INITIAL;
    private _show_progressbar_cb: number | null = null;
}
