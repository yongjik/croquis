# Helper class for interfacing with IPython display API.

import uuid

import IPython.display
import jinja2

from . import comm, env_helper

comm_reopened = False

# Encapsulates a canvas output, with a unique "canvas ID" (which is our own -
# shouldn't be confused with anything IPython does).
class DisplayObj(object):
    DEFAULT_CONFIG = {
        'debug': False,
        'reload_fe': False,  # Force reload frontend js, for debugging.

        '_reopen_comm': False,

        # Where to find our js module: see env_helper.py and setup.py.
        '_js_module_name':
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

        # If this function is called the first time (since last kernel restart),
        # tell FE to re-open the communication channel.  Note that FE may have
        # started earlier and may be holding a reference to a stale channel
        # (from the previous kernel).
        #
        # For details about communication channels, see comm.py.
        global comm_reopened
        if not comm_reopened:
            self.config['_reopen_comm'] = True
            comm_reopened = True

            # In dev environment, always force reload frontend after kernel
            # restart.
            if env_helper.is_dev():
                self.config['reload_fe'] = True

    def register_handler(self, msgtype, callback):
        comm.comm_manager.register_handler(self.canvas_id, msgtype, callback)

    def show(self):
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
      <button class="cr_home_btn">&#x1f3e0; Reset</button>
      &nbsp; Drag mouse to:
      <input type="radio" name="{{canvas_id}}-radio"
             id="{{canvas_id}}-zoom" value="zoom" checked/>
      <label for="{{canvas_id}}-zoom">zoom</label>
      <input type="radio" name="{{canvas_id}}-radio"
             id="{{canvas_id}}-pan" value="pan"/>
      <label for="{{canvas_id}}-pan">pan</label>
    </div>
    <div class="cr_main1" dir="ltr">
      <!-- The height of cr_y_axis must be manually adjusted to match (canvas
           height) + (width of x axis line).  -->
      <div class="cr_y_axis"></div>
      <div class="cr_canvas_plus_x_axis">
        <div class="cr_canvas">
          <div class="cr_progressbar">Please wait, the graph is being generated ...</div>
          <div class="cr_inner"></div>
          <div class="cr_foreground"></div>
          <div class="cr_grid"></div>
          <div class="cr_select_area"></div>
        </div>
        <div class="cr_x_axis"></div>
      </div>
      <div class="cr_legend">
        <div class="cr_searchbox">
          <input type="text" placeholder="(all shown)"/>
        </div>
        <div class="cr_search_ctrl">
          <input type=checkbox class="cr_regex"/>Regex
          <input type=checkbox class="cr_autoselect" checked/>Autoselect
          <button class="cr_more">More...</button>
          <ul class="cr_btn_popup">
              <li><a class="cr_select_all">Select all</a></li>
              <li><a class="cr_deselect_all">Deselect all</a></li>
              <!-- text for the following two links are filled in
                   dynamically. -->
              <li><a class="cr_select_matching"></a></li>
              <li><a class="cr_deselect_matching"></a></li>
          </ul>
        </div>
        <div class="cr_search_stat"></div>
        <ul class="cr_search_result"></ul>
        <div class="cr_info"></div>
      </div>
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
    require.undef('nbextensions/{{_js_module_name}}');
    {% endif %}

    requirejs(['base/js/utils'], function(utils) {
        utils.load_extension('{{_js_module_name}}').then((croquis) => {
            console.log('croquis_fe module object is: ', croquis)
            croquis.init({{'true' if reload_fe else 'false'}},
                         {{'true' if _reopen_comm else 'false'}});
            ctxt = new croquis.Ctxt('{{canvas_id}}');
            console.log('croquis_fe: created ctxt object: ', ctxt);
        }).catch((err) => {
            console.log('Error occurred loading croquis_fe module: ', err)
        });
    });
</script>''')

        IPython.display.display(
            IPython.display.HTML(html.render(self.config)))
