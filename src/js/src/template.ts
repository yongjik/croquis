// The HTML template.

function is_debug(ctxt_id: string) { ctxt_id.endsWith("-dbg"); }

// Current setup:
//  - div .croquis_nbext : outermost container
//    - div #{{ctxt_id}}-btns : buttons for debugging
//    - div #{{ctxt_id}} .cr_main : the whole area including axes
//      - div .cr_ctrl_panel : "Control panel" at the top.
//        - span .cr_ctrl_btns
//          - button .cr_home_btn     : home (reset) button
//          - button .cr_zoom_in_btn  : zoom in
//          - button .cr_zoom_out_btn : zoom out
//        - input #{{ctxt_id}}-zoom : "drag mouse to zoom"
//        - input #{{ctxt_id}}-pan  : "drag mouse to pan"
//      - div .cr_main1
//        - div .cr_y_axis : y axis
//        - div cr_canvas_plus_x_axis
//          - div .cr_canvas : the main canvas --> CtxtImple.canvas
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
//    - div id={{canvs_id}}-log : debug logs --> CtxtImple.log_area
//
// See also display.py for HTML structure.
export function apply_template(node: HTMLElement, ctxt_id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(ctxt_id)) {
        console.log(`ctxt_id contains bad characters: [${ctxt_id}]`);
        throw new Error(`ctxt_id contains bad characters: [${ctxt_id}]`);
    }

    let template = `
      <div class="croquis_nbext">
!       <div id="${ctxt_id}-btns" class="cr_dbg_btns">
!         <button>Record</button> <button>Stop</button>
!         <button>Save</button> <button>Load</button>
!         <button>Replay</button> <button>Clear</button>
!         <span>...</span>
!       </div>
        <div id="${ctxt_id}" class="cr_main">
          <div class="cr_ctrl_panel">
            <span class="cr_ctrl_btns">
              <button class="cr_home_btn">&#x1f3e0; Reset</button>
              <button class="cr_zoom_in_btn">&#x1f50d;<sup>+</sup></button>
              <button class="cr_zoom_out_btn"><small>&#x1f50d;</small><sup>-</sup></button>
            </span>
            &nbsp; Drag mouse to:
            <input type="radio" name="${ctxt_id}-radio"
                   id="${ctxt_id}-zoom" value="zoom" checked/>
            <label for="${ctxt_id}-zoom">zoom</label>
            <input type="radio" name="${ctxt_id}-radio"
                   id="${ctxt_id}-pan" value="pan"/>
            <label for="${ctxt_id}-pan">pan</label>
          </div>
          <div class="cr_main1" dir="ltr">
            <!-- Built by TileHandler. -->
          </div>
!         <div class="cr_dbg_status"></div>
        </div>
!       <div id="${ctxt_id}-log" class="cr_dbglog"><b>Debug logging</b><br /></div>
      </div>
    `;

    if (is_debug(ctxt_id)) {
        // remove all "!" at the beginning of lines.
        template = template.replace(/^!/gm, " ");
    } else {
        // filter out all lines starting with "!".
        template = template.split("\n").filter((line) => !/^!/.test(line)).join("\n");
    }

    const elem = document.createElement("template");
    elem.innerHTML = template;
    node.appendChild(elem.content);
}
