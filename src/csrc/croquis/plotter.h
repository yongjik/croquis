// The plotter algorithm.

#pragma once

#include <list>
#include <memory>  // unique_ptr
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>  // pair
#include <vector>

#include "croquis/buffer.h"
#include "croquis/canvas.h"
#include "croquis/figure_data.h"
#include "croquis/util/macros.h"  // DISALLOW_COPY_AND_MOVE
#include "croquis/util/optional.h"  // optional

namespace croquis {

namespace py = pybind11;

template<typename DType> class IntersectionResult;
template<typename DType> class IntersectionResultSet;
class Task;

// OK, let's try with the most basic configuration: we'll grow from here.
//
// line_cnt: how many lines we have.
// pts_cnt: how many points per lines.
// X, Y: 2-dimensional array [line_cnt][pts_cnt].
// colors: 2-dimensional array [line_cnt][3] (for RGB).
class Plotter {
  private:
    std::mutex m_;

    std::vector<std::unique_ptr<FigureData>> data_;

    // During the data building: the next item ID and atom_idx.
    // After that: the number of items and atoms.
    int next_item_id_ = 0;
    int64_t next_atom_idx_ = 0;

    std::string err_msg_;

    // Min/max coordinates of the data - does not change once computed.
    Range2D range_;

    // Keeps track of which items are currently enabled for drawing.
    //
    // Initialized by Python's Plotter.show(): once it is initialized, we
    // don't accept any more FigureData.
    optional<SelectionMap> sm_;
    bool show_called() const { return bool(sm_); }

    // Sequence number for the tiles sent back to FE.
    int tile_seq_no_ = 0;

    // Largest sequence number "acknowledged" by FE.
    int ack_seq_ = -1;

    // Helper class to keep data that belong to one FE request in a single
    // place.  We own the intersection tasks.
    struct TaskCtxt {
        std::vector<std::unique_ptr<Task>> intersection_tasks;
        std::unique_ptr<IntersectionResultSet<int64_t>> irs;
    };

    // Exactly one of `task_data` and `task` is non-NULL.
    // - If intersections are being computed: (task_data != nullptr).
    // - If the corresponding tile is being generated: (tile_task != nullptr).
    // - If the relevant tile was already sent to FE: `tile_task` holds a
    //   reference to a complete task - any attempt to expedite_task() will be
    //   silently ignored.  Task is cleaned up once `ack_seq_` advances over.
    //
    // Since we're operating LIFO, if we get a duplicate request (and if the
    // tile response was not yet sent back), we move the old seq# to
    // `orphaned_seqs_` and update `seq_no` here: in that way, the old seq# is
    // immediately "acknowledged" and FE's count of in-flight requests does not
    // increase.
    struct InflightTileInfo {
        TaskCtxt *task_ctxt;
        std::unique_ptr<Task> tile_task;
        int seq_no;

        InflightTileInfo(TaskCtxt *ctxt, int seq_no)
            : task_ctxt(ctxt), seq_no(seq_no) { }
    };

    // Requests that are being processed or sent to FE.  Tiles are removed from
    // here if (seq_no <= ack_seq_).
    std::unordered_map<TileKey, InflightTileInfo> inflight_tiles_;

    // Requests that are sent to FE.  Key is (sequence #).
    std::unordered_map<int, TileKey> sent_tiles_;

    // We also keep a sliding window of requests that are sent to FE, so that we
    // can "forget" tiles that were sent too long ago.  Each pair is (seq_no,
    // timestamp).
    static const int64_t TILE_ACK_EXPIRE_USEC = 5000000;  // = 5 sec
    std::list<std::pair<int, int64_t>> sent_tile_list_;

    // Sequence numbers superceded by duplicate requests.
    std::vector<int> orphaned_seqs_;

  public:
    Plotter() { }

    // Wrapper function to instantiate and register a FigureData object.
    template<typename T, typename... Args>
    void add_figure_data(Args&&... args) {
        std::unique_lock<std::mutex> lck(m_);

        add_figure_data(
            lck,
            std::make_unique<T>(next_item_id_, next_atom_idx_,
                                std::forward<Args>(args)...)
        );
    }

  private:
    // Register a new FigureData.
    // Must be called with mutex held.
    void add_figure_data(const std::unique_lock<std::mutex> &lck,
                         std::unique_ptr<FigureData> fd);

  public:
    // Create a new canvas config: called by FE message `canvas_config_req`.
    // See messages.txt for details.
    //
    // `old_config` is nullptr if it's a "reset" request.
    // px0, py0, px1, py1 are meaningful only if `is_zoom` is true.
    void create_canvas_config(
             int new_config_id, int width, int height,
             const CanvasConfig *old_config,
             bool is_zoom, float px0, float py0, float px1, float py1);

  public:
    std::pair<bool *, size_t> init_selection_map();

    // Start/stop update of SelectionMap.
    int get_sm_version() const { return sm_->version.load(); }
    void start_selection_update() { sm_->start_update(); }
    void end_selection_update(int new_version) { sm_->end_update(new_version); }

    // Receive FE's acknowledgements about tiles we have sent.
    void acknowledge_seqs(const std::vector<int> &seqs);

    // Handle FE request for tiles for the given ID.
    //
    // If `item_id` is -1, then FE is requesting regular (non-highlight) tiles.
    // Otherwise, FE is requesting highlight tiles.
    //
    // For regular tiles, the Python handler also ensures that this function is
    // called after `sm_version` reaches the requested version, so C++ code does
    // not need to check the requested version.
    //
    // FE request message may contain multiple items: the Python handler calls
    // this function once for each line.
    //
    // `prio_coords` and `reg_coords` are vectors of length multiple of 3, made
    // of coordinates (tile row, tile col, seq_no).
    void tile_req_handler(const CanvasConfig *canvas, int item_id,
                          const std::vector<int> &prio_coords,
                          const std::vector<int> &reg_coords);

  private:
    // Launch tasks to draw necessary tiles.
    // Must be called with mutex held.
    void launch_tasks(const std::unique_lock<std::mutex> &lck,
                      const PlotRequest req,
                      const std::vector<int> &prio_coords,
                      const std::vector<int> &reg_coords);

    // Helper function to de-duplicate coordinates that are already in-flight.
    // Must be called with mutex held.
    std::vector<int> dedup_inflight_reqs(
                         const std::unique_lock<std::mutex> &lck,
                         const PlotRequest req, TaskCtxt *ctxt,
                         const std::vector<int> &coords);

    void compute_intersection_task(
             const PlotRequest req, const IntersectionResultSet<int64_t> *irs,
             IntersectionResult<int64_t> *result);

    void tile_launcher_task(const PlotRequest req,
                            std::unique_ptr<TaskCtxt> ctxt);

    void draw_tile_task(const PlotRequest req,
                        const IntersectionResultSet<int64_t> *irs,
                        int row, int col);

    // Helper function to find atom indices.
    std::pair<int64_t, int64_t> get_atom_idxs(int item_id);

    // TODO: Do we need this?
    void set_error(const std::string &msg);

  public:
    // If there's any error, return the error string.
    // Otherwise, returns empty string.
    std::string check_error() const { return err_msg_; }

    DISALLOW_COPY_AND_MOVE(Plotter);
};

} // namespace croquis
