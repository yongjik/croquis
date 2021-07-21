// The entry point for the croquis frontend module.
//
// cf. https://mindtrove.info/4-ways-to-extend-jupyter-notebook/#nb-extensions
//     https://jupyter-notebook.readthedocs.io/en/stable/extending/frontend_extensions.html
//
// At first I tried bundling all the js code via webpack, but for some reason,
// requirejs.toUrl() would stop working after bundling via webpack, so I
// couldn't import CSS.  (In other libraries such as ipympl, the CSS file itself
// is also bundled together and dynamically "loaded" via webpack's
// `style-loader`, but that seemed like too much magic.)
//
// So this is a compromise: this "loader" module is copied verbatim into
// notebook's "nbextension" directory, so that we can use all the features of
// requirejs without issues.  The rest of the code is then bundled by webpack to
// create `croquis_fe.js`.
//
// NOTE: Contrary to the name, this module doesn't actually *load* the main
//       module: it's loaded together by the code emitted by `display.py`.

define([
    'module',  // myself
    'jquery',
    'require',
    'base/js/namespace'
], function(module, $, requirejs, Jupyter) {

//------------------------------------------------

'use strict';

let css_loaded = null;  // Promise object.
let comm = null;  // Websocket communication channel provided by Jupyter.
let comm_ready_resolve = null;
let comm_ready = new Promise((resolve, reject) => {
    comm_ready_resolve = resolve;  // Will be called when BE is ready.
});

// Copied from `BE_uuid` of comm.py: used to detect BE restart.
let last_BE_uuid = null;

let ctxt_map = {};  // Map of contexts by canvas IDs.

// Current time as string HH:MM:SS.mmm, for debug logging.
function get_timestamp_str() {
    let T = new Date();
    let fmt = (x, sz) => ('000' + x).slice(-sz);  // Seriously, no printf??
    return fmt(T.getHours(), 2) + ':' + fmt(T.getMinutes(), 2) + ':' +
           fmt(T.getSeconds(), 2) + '.' + fmt(T.getMilliseconds(), 3);
}

// Add a module-level resize handler.
window.addEventListener('resize', resize_handler);

// It's possible that the cell's output width is changed even without window
// resizing.  For example, a cell may execute something like:
//      from IPython.core.display import display, HTML
//      display(HTML("<style>.container { width:100% !important; }</style>"))
//
// Apparently it's very hard to add a generic "resize handler" for individual
// elements.  (There's a library for it [https://github.com/marcj/css-element-queries]
// but I don't want to add too much dependency.)  So, let's just periodically
// check if cell size changed.  It doesn't need to be fast as such an event
// should be pretty infrequent (for now).
//
// TODO: I need to clean up this handler once the module is unloaded?
let resize_timer = window.setInterval(resize_handler, 500 /* ms */);

function load_ipython_extension() {
    console.log('croquis_fe module loaded by Jupyter:', module.id);
    load_css(false /* !force_reload */);
}

// We need a separate function from load_ipython_extension() because during
// development we want to be able to reload this module (triggered by Python
// class `DisplayObj` via calling `require.undef`), but Jupyter only calls
// load_ipython_extension() for the very first invocation.
function init(force_reload, BE_uuid) {
    console.log(`${get_timestamp_str()} croquis_fe.init() called: ` +
                `force_reload=${force_reload} BE_uuid=${BE_uuid}`);
    // console.log('comm = ', comm);
    load_css(force_reload);
    if (BE_uuid != last_BE_uuid) {
        console.log(`${get_timestamp_str()} BE_uuid changed from ` +
                    `${last_BE_uuid} to ${BE_uuid}: re-opening comm ...`);
        last_BE_uuid = BE_uuid;
        // See: https://jupyter-notebook.readthedocs.io/en/stable/comms.html
        comm = Jupyter.notebook.kernel.comm_manager.new_comm(
            'croquis', {'msg': 'FE_loaded'})
        comm.on_msg(msg_dispatcher);
    }
}

// module.id should be `nbextensions/croquis_loader_dev` (for dev environment)
// or `nbextensions/croquis_fe/croquis_loader` (when installed via package).
//
// (Yeah, it would've been nice if they are at the same level, but
// `notebook.nbextensions.install_nbextension` does not support subdirectories,
// while it's probably a bad idea to install our js files at the top level
// `nbextensions/` when we build a package.)
//
// In Linux, assuming Anaconda, the actual location would be:
//      dev:       ~/.local/share/jupyter/nbextensions/croquis_loader_dev.js
//      installed: $CONDA_PREFIX/share/jupyter/nbextensions/croquis_fe/croquis_loader.js
const is_dev = (module.id.search('croquis_loader_dev') != -1);

// Load CSS if necessary.
// cf. https://jupyter-contrib-nbextensions.readthedocs.io/en/latest/internals.html
function load_css(force_reload) {
    css_loaded = new Promise((resolve, reject) => {
        let existing_css = document.querySelector('head .croquis_fe_css');

        if (existing_css != null) {
            if (!force_reload) {
                console.log('croquis_fe: CSS is already loaded.');
                resolve();
                return;
            }
            console.log('croquis_fe: reloading CSS ..');
            existing_css.remove();
        }

        const css_name = (is_dev) ? './croquis_fe_dev.css' : './croquis_fe.css';
        let css_url = requirejs.toUrl(css_name);
        console.log(`Loading CSS (force_reload=${force_reload}): ${css_url}`);

        let link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.classList.add('croquis_fe_css');
        link.href = css_url;
        link.onload = function() {
            console.log('CSS loaded !!!');
            resolve();
        };
        link.onerror = function() {
            // At least on Chrome, this seems to fire only when the CSS
            // link itself is unavailable.
            console.log('CSS load failure !!!');
            reject();
        };

        document.querySelector('head').appendChild(link);
    });
}

// Handles websocket message via Jupyter's channel.
function msg_dispatcher(msg) {
    // console.log('Received comm: ', msg);
    let data = msg.content.data;

    if (data.msg == 'BE_ready') {
        console.log('Backend is ready!');
        if (comm_ready_resolve != null) {
            comm_ready_resolve();
            comm_ready_resolve = null;
        }
        return;
    }

    let canvas_id = msg.content.data.canvas_id;
    if (!(canvas_id in ctxt_map)) {
        console.log('Unknown canvas_id: ', canvas_id);
        return;
    }

    // If exists, msg.buffers holds binary data (e.g., PNG images).
    ctxt_map[canvas_id].msg_handler(msg.content.data, msg.buffers || []);
}

// Called by `Ctxt` to send message to BE.
function send_msg(data) {
    comm_ready.then(() => { comm.send(data) });
}

function resize_handler() {
    for (let canvas_id in ctxt_map) ctxt_map[canvas_id].resize_handler();
}

function create_ctxt(main_module, canvas_id) {
    let env = {
        $: $,
        ctxt_map: ctxt_map,
        css_loaded: css_loaded,
        send_msg: send_msg,
    };
    return new main_module.Ctxt(env, canvas_id);
}

return {
    load_ipython_extension: load_ipython_extension,
    init: init,
    create_ctxt: create_ctxt,
};

//------------------------------------------------

});
