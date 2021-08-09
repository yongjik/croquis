# Helper class for interfacing with IPython display API.

import uuid

import IPython.display
import jinja2

from . import comm, env_helper

comm_reopened = False

# Encapsulates a canvas output, with a unique "canvas ID" (which is our own -
# shouldn't be confused with anything IPython does).
class DisplayObj(object):
    # `debug=True` enables these buttons for FE debugging:
    #
    #     * Record: Start recording events and logs into the internal buffer.
    #     * Stop: Stop recording.
    #     * Save: Save the recorded events and logs to a file.
    #     * Load: Load the saved events from a previous run.
    #     * Replay: Start replaying the events generated by either "Record" or
    #               "Load".
    #     * Clear: Clear the internal buffer.
    #
    # Load/Replay buttons were added to debug the highlight algorithm (i.e.,
    # "Why does it not highlight line #3 when the cursor is on top of it?"), but
    # the code is very haphazard - there's no guarantee that they may work.
    #
    # See `EventReplayer` in croquis_fe.js for details.
    DEFAULT_CONFIG = {
        'debug': False,
        'reload_fe': False,  # Force reload frontend js, for debugging.

        # Where to find our js modules: see env_helper.py and setup.py.
        '_js_loader_module':
            'croquis_loader_dev' if env_helper.is_dev()
                                 else 'croquis_fe/croquis_loader',
        '_js_main_module':
            'croquis_fe_dev' if env_helper.is_dev()
                             else 'croquis_fe/croquis_fe',
    }

    def __init__(self, **kwargs):
        # Create a random "unique" ID.
        #
        # We add a prefix, because document.querySelector() in js doesn't like
        # ID's starting with a digit.  (Well, weirdly, jquery seems to work just
        # fine with these IDs, so YMMV...)
        self.canvas_id = 'v-' + str(uuid.uuid4())

        self.config = {'canvas_id': self.canvas_id}
        for key, default_val in self.DEFAULT_CONFIG.items():
            self.config[key] = kwargs.pop(key, default_val)
        assert not kwargs, 'Unknown options: ' + str(kwargs)

    def register_handler(self, msgtype, callback):
        comm.comm_manager.register_handler(self.canvas_id, msgtype, callback)

    def show(self):
        # In dev environment, always force reload frontend after kernel restart.
        global comm_reopened
        if not comm_reopened:
            comm_reopened = True
            if env_helper.is_dev():
                self.config['reload_fe'] = True

        self.config['BE_uuid'] = comm.BE_uuid

        # NOTE: Please keep this in sync with comments on Ctxt (croquis_fe.js).
        html = jinja2.Template('''
<div class="croquis_nbext">
  {% if debug %}
  <div id="{{canvas_id}}-btns" class="cr_dbg_btns">
    <button>Record</button> <button>Stop</button>
    <button>Save</button> <button>Load</button>
    <button>Replay</button> <button>Clear</button>
    <span>...</span>
  </div>
  {% endif %}
  <div id="{{canvas_id}}" class="cr_main">
    <div class="cr_ctrl_panel">
      <span class="cr_ctrl_btns">
        <button class="cr_home_btn">&#x1f3e0; Reset</button>
        <button class="cr_zoom_in_btn">&#x1f50d;<sup>+</sup></button>
        <button class="cr_zoom_out_btn"><small>&#x1f50d;</small><sup>-</sup></button>
      </span>
      &nbsp; Drag mouse to:
      <input type="radio" name="{{canvas_id}}-radio"
             id="{{canvas_id}}-zoom" value="zoom" checked/>
      <label for="{{canvas_id}}-zoom">zoom</label>
      <input type="radio" name="{{canvas_id}}-radio"
             id="{{canvas_id}}-pan" value="pan"/>
      <label for="{{canvas_id}}-pan">pan</label>
    </div>
    <div class="cr_main1" dir="ltr">
      <!-- Built by TileHandler in FE. -->
    </div>
    {% if debug %}
    <!-- <div class="cr_dbg_status"></div> -->
    {% endif %}
  </div>
  {% if debug %}
  <div id="{{canvas_id}}-log" class="cr_dbglog"><b>Debug logging</b><br /></div>
  {% endif %}
</div>
<script>
    // console.log('Jupyter notebook: ', Jupyter.notebook);
    // console.log('base URL: ', Jupyter.notebook.config.base_url);

    {% if reload_fe %}
    // Force reload for dev environment.
    require.undef('nbextensions/{{_js_loader_module}}');
    require.undef('nbextensions/{{_js_main_module}}');
    {% endif %}

    requirejs(['base/js/utils'], function(utils) {
        Promise.all([
            utils.load_extension('{{_js_loader_module}}'),
            utils.load_extension('{{_js_main_module}}'),
        ]).then((values) => {
            console.log('croquis module objects are: ', values);
            let [loader, main] = values;
            loader.init({{'true' if reload_fe else 'false'}}, '{{BE_uuid}}');
            ctxt = loader.create_ctxt(main, '{{canvas_id}}');
            console.log('croquis_fe: created ctxt object: ', ctxt);
        }).catch((err) => {
            console.log('Error occurred loading croquis_fe module: ', err)
        });
    });
</script>''')

        IPython.display.display(
            IPython.display.HTML(html.render(self.config)))
