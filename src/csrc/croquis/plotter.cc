// The plotter algorithm.

#include "croquis/plotter.h"

#include <inttypes.h>  // PRId64
#include <math.h>  // powf
#include <stdio.h>  // printf (for debugging)

#include <algorithm>  // min
#include <mutex>
#include <tuple>  // tie

#include "croquis/constants.h"
#include "croquis/intersection_finder.h"
#include "croquis/rgb_buffer.h"
#include "croquis/task.h"  // make_lambda_task
#include "croquis/thr_manager.h"
#include "croquis/util/error_helper.h"  // throw_value_error
#include "croquis/util/logging.h"  // DBG_LOG1
#include "croquis/util/math.h"
#include "croquis/util/stl_container_util.h"  // append_str
#include "croquis/util/string_printf.h"

#define DEBUG_PLOT 0

namespace croquis {

void Plotter::add_figure_data(const std::unique_lock<std::mutex> &lck,
                              std::unique_ptr<FigureData> fd)
{
    CHECK(lck.owns_lock());

    if (show_called()) {
        // TODO: Not really a ValueError ...
        util::throw_value_error(
            "Figure data cannot be added after drawing started.");
    }

    CHECK(fd->start_item_id == next_item_id_);
    next_item_id_ += fd->item_cnt;
    CHECK(fd->start_atom_idx == next_atom_idx_);
    next_atom_idx_ += fd->atom_cnt;

    range_.merge(fd->range());
    data_.push_back(std::move(fd));
}

std::pair<bool *, size_t> Plotter::init_selection_map()
{
    DBG_LOG1(DEBUG_PLOT, "init_selection_map() called!!");

    CHECK(!show_called());
    sm_.emplace(next_item_id_);

    return { const_cast<bool *>(sm_->m.get()), sm_->sz };
}

void Plotter::create_canvas_config(
         int new_config_id, int width, int height,
         const CanvasConfig *old,
         bool is_zoom, float px0, float py0, float px1, float py1)
{
    std::unique_lock<std::mutex> lck(m_);

    CHECK(width >= 1 && height >= 1);  // Sanity check.

    double x0, y0, x1, y1;

    if (old == nullptr) {
        // Reset the canvas to hold the entire data.
        std::tie(x0, x1) = util::initial_range(range_.xmin, range_.xmax);
        std::tie(y0, y1) = util::initial_range(range_.ymin, range_.ymax);
    }
    else {
        // Compute data coordinates for the given offset.
        // If `is_zoom` is false, then set the coordinate to encompass the
        // current viewable area.
        if (!is_zoom) {
            px0 = -old->x_offset;
            py0 = (old->h - 1) - old->y_offset;
            px1 = (old->w - 1) - old->x_offset;
            py1 = -old->y_offset;
        }

        CanvasConfig::Point pt0 = old->get_data_coord(px0, py0);
        CanvasConfig::Point pt1 = old->get_data_coord(px1, py1);

        x0 = fmin(pt0.x, pt1.x);
        y0 = fmin(pt0.y, pt1.y);
        x1 = fmax(pt0.x, pt1.x);
        y1 = fmax(pt0.y, pt1.y);
    }

    int nrows = (height + TILE_SIZE - 1) / TILE_SIZE;
    int ncols = (width + TILE_SIZE - 1) / TILE_SIZE;

    // In Python code, Plotter._send_msg() will re-package this inside
    // `canvas_config` and add the axis data.
    tmgr_->send_msg(this, {
        "msg=CanvasConfigSubMessage",
        "#config_id=" + std::to_string(new_config_id),
        "#w=" + std::to_string(width),
        "#h=" + std::to_string(height),
        "x0=" + util::double_to_string(x0),
        "y0=" + util::double_to_string(y0),
        "x1=" + util::double_to_string(x1),
        "y1=" + util::double_to_string(y1),
        "#zoom_level=0",
        "#x_offset=0",
        "#y_offset=0",
    });

    // Canvas config has changed, so we generate *all* tiles in the range.
    std::vector<int> tile_coords;
    for (int row = 0; row < nrows; row++) {
        for (int col = 0; col < ncols; col++) {
            tile_coords.push_back(row);
            tile_coords.push_back(col);
            tile_coords.push_back(-1);  // No sequence #.
        }
    }

    CanvasConfig new_config(new_config_id, width, height, x0, y0, x1, y1);
    launch_tasks(lck,
                 PlotRequest(sm_->version.load(), new_config, -1 /* item_id */),
                 tile_coords, {});
}

void Plotter::acknowledge_seqs(const std::vector<int> &seqs)
{
    std::unique_lock<std::mutex> lck(m_);

//  for (const auto &iter : inflight_tiles_) {
//      DBG_LOG1(DEBUG_PLOT, "AAA inflight_tiles_ contains [%s] seq=%d",
//               iter.first.debugString().c_str(), iter.second.seq_no);
//  }

    for (int seq : seqs) {
        const auto iter = sent_tiles_.find(seq);
        if (iter == sent_tiles_.end()) {
            DBG_LOG1(DEBUG_PLOT,
                     "FE acknowledged tile #%d but we don't know about it - "
                     "maybe we already forgot it?", seq);
            continue;
        }

        const auto key = iter->second;
        DBG_LOG1(DEBUG_PLOT, "FE acknowledged receving tile #%d (%s)",
                 seq, key.debugString().c_str());

        const auto iter2 = inflight_tiles_.find(key);
        CHECK(iter2 != inflight_tiles_.end());
        CHECK(iter2->second.task_ctxt == nullptr);  // Sanity check.
        CHECK(iter2->second.seq_no == seq);  // Sanity check.
        inflight_tiles_.erase(iter2);

        sent_tiles_.erase(iter);
    }

    // Also forget tiles that are too old.
    int64_t T = util::microtime();
    while (!sent_tile_list_.empty()) {
        auto v = sent_tile_list_.front();
        int seq = v.first;
        const auto iter = sent_tiles_.find(seq);
        if (iter == sent_tiles_.end()) {
            // We already received acknowledgement for this tile.
            sent_tile_list_.pop_front();
            continue;
        }

        const auto key = iter->second;
        int64_t age = T - v.second;
        if (age < TILE_ACK_EXPIRE_USEC) break;

        DBG_LOG1(DEBUG_PLOT, "Forgetting tile #%d [%s] - age %" PRId64 " us.",
                 seq, key.debugString().c_str(), age);

        const auto iter2 = inflight_tiles_.find(key);
        CHECK(iter2 != inflight_tiles_.end());
        CHECK(iter2->second.task_ctxt == nullptr);  // Sanity check.
        CHECK(iter2->second.seq_no == seq);  // Sanity check.
        inflight_tiles_.erase(iter2);

        sent_tiles_.erase(iter);
    }

//  for (const auto &iter : inflight_tiles_) {
//      DBG_LOG1(DEBUG_PLOT, "BBB inflight_tiles_ contains [%s] seq=%d",
//               iter.first.debugString().c_str(), iter.second.seq_no);
//  }
}

void Plotter::tile_req_handler(const CanvasConfig *canvas, int item_id,
                               const std::vector<int> &prio_coords,
                               const std::vector<int> &reg_coords)
{
    DBG_LOG1(DEBUG_PLOT, "tile_req_handler called! "
             "config_id=%d zoom_level=%d item_id=%d",
             canvas->id, canvas->zoom_level, item_id);

    std::unique_lock<std::mutex> lck(m_);

    launch_tasks(lck,
                 PlotRequest(sm_->version.load(), *canvas, item_id),
                 prio_coords, reg_coords);
}

void Plotter::launch_tasks(const std::unique_lock<std::mutex> &lck,
                           const PlotRequest req,
                           const std::vector<int> &prio_coords,
                           const std::vector<int> &reg_coords)
{
    CHECK(lck.owns_lock());

    auto ctxt = std::make_unique<TaskCtxt>();
    std::vector<int> prio_coords2 =
        dedup_inflight_reqs(lck, req, ctxt.get(), prio_coords);
    std::vector<int> reg_coords2 =
        dedup_inflight_reqs(lck, req, ctxt.get(), reg_coords);

    if (prio_coords2.empty() && reg_coords2.empty()) {
        DBG_LOG1(DEBUG_PLOT, "No task left after deduplication!");
        return;
    }

    // First, decide the number of subtasks to create.
    int64_t start_idx, end_idx;
    if (req.item_id == -1) {
        // Draw everything.
        start_idx = 0;
        end_idx = next_atom_idx_;
    }
    else {
        std::tie(start_idx, end_idx) = get_atom_idxs(req.item_id);
    }

    int64_t batch_size =
        std::min(std::max((int64_t) 5000,
                          (end_idx - start_idx) / tmgr_->nthreads),
                 (int64_t) 100000);

    ctxt->irs = std::make_unique<IntersectionResultSet<int64_t>>(
        prio_coords2, reg_coords2, start_idx, end_idx, batch_size);
    auto ctxt_ptr = ctxt.get();
    auto irs_ptr = ctxt->irs.get();

    // We kick off these four kinds of tasks:
    //
    // 1. compute_intersection_task() runs for each batch, and records
    //    which data points intersect which tile.
    // 2. After that, tile_launcher_task() runs and enqueues one tile_task() per
    //    tile.
    // 3. draw_tile_task() runs for each tile, generates the tile data, and
    //    sends it back.
    // 4. `cleanup_task` frees the intermediate data.

    // `tile_launcher` runs after all compute_intersection_task() tasks run.
    auto tile_launcher = make_lambda_task([=, ctxt=std::move(ctxt)]() mutable {
        tile_launcher_task(req, std::move(ctxt));
    });

    for (const auto &ir : irs_ptr->results) {
        IntersectionResult<int64_t> *ir_ptr = ir.get();
        DBG_LOG1(DEBUG_PLOT, "Enqueueing compute_interaction_task ...");
        ctxt_ptr->intersection_tasks.push_back(
            ThrManager::enqueue_lambda_no_delete(
                [=]() { compute_intersection_task(req, irs_ptr, ir_ptr); },
                Task::SCHD_LIFO, tile_launcher.get()
            )
        );
    }

    DBG_LOG1(DEBUG_PLOT, "Enqueueing tile_launcher task %p ...",
             tile_launcher.get());
    ThrManager::enqueue(std::move(tile_launcher));
}

std::vector<int> Plotter::dedup_inflight_reqs(
                     const std::unique_lock<std::mutex> &lck,
                     const PlotRequest req, TaskCtxt *ctxt,
                     const std::vector<int> &coords)
{
    CHECK(lck.owns_lock());

    std::vector<int> retval;
    CHECK(coords.size() % 3 == 0);
    retval.reserve(coords.size() * 2 / 3);

//  for (const auto &iter : inflight_tiles_) {
//      DBG_LOG1(DEBUG_PLOT, "CCC inflight_tiles_ contains [%s] seq=%d",
//               iter.first.debugString().c_str(), iter.second.seq_no);
//  }

    for (int i = 0; i < coords.size(); i += 3) {
        int row = coords[i];
        int col = coords[i + 1];
        int seq = coords[i + 2];
        TileKey key(req.sm_version, req.canvas.id, req.canvas.zoom_level,
                    row, col, req.item_id);
        const auto iter = inflight_tiles_.find(key);

        // XXX TMP
        DBG_LOG1(DEBUG_PLOT, "dedup: search key [%s]", key.debugString().c_str());

        if (iter == inflight_tiles_.end()) {
            DBG_LOG1(DEBUG_PLOT,
                     "dedup: tile [%s] not found, adding (seq #%d) ...",
                     key.debugString().c_str(), seq);

            util::get_or_emplace(inflight_tiles_, key, ctxt, seq);
            retval.push_back(row);
            retval.push_back(col);

            continue;
        }

        // This tile is already being processed!
        InflightTileInfo &info = iter->second;
        int prev_seq = info.seq_no;

        if (sent_tiles_.count(prev_seq)) {
            DBG_LOG1(DEBUG_PLOT, "dedup: tile [%s] was already sent (seq #%d).",
                     key.debugString().c_str(), prev_seq);
            orphaned_seqs_.push_back(seq);
            continue;
        }

        DBG_LOG1(DEBUG_PLOT,
                 "dedup: tile [%s] is already being processed (seq #%d).",
                 key.debugString().c_str(), prev_seq);
        orphaned_seqs_.push_back(prev_seq);
        info.seq_no = seq;

        if (info.task_ctxt != nullptr) {
            // Tell the scheduler to find intersections more quickly. :)
            DBG_LOG1(DEBUG_PLOT, "Expediting intersection tasks ...");
            for (auto &t : info.task_ctxt->intersection_tasks)
                ThrManager::expedite_task(t.get());
        }
        else {
            // Expedite the tile-drawing task (if it's still enqueued).
            // If the task is already executing/finished, it has no effect.
            CHECK(info.tile_task != nullptr);
            DBG_LOG1(DEBUG_PLOT, "Expediting tile task [%p] ...",
                     info.tile_task.get());
            ThrManager::expedite_task(info.tile_task.get());
        }
    }

    return retval;
}

// Runs in the thread pool.
void Plotter::compute_intersection_task(
         const PlotRequest req, const IntersectionResultSet<int64_t> *irs,
         IntersectionResult<int64_t> *result)
{
    const int64_t batch_start = result->start_id;
    const int64_t batch_end = result->end_id;

    // TODO: Use binary search?
    for (auto &fd : data_) {
        int64_t fd_start = fd->start_atom_idx;
        int64_t fd_end = fd->start_atom_idx + fd->atom_cnt;
        if (batch_start < fd_end && batch_end > fd_start)
            fd->compute_intersection(req, *sm_, irs, result);
    }
}

// Runs in the thread pool.
void Plotter::tile_launcher_task(const PlotRequest req,
                                 std::unique_ptr<TaskCtxt> ctxt)
{
    std::unique_lock<std::mutex> lck(m_);

    // Reap completed tasks.
    ctxt->intersection_tasks.clear();

    auto ctxt_ptr = ctxt.get();
    auto irs_ptr = ctxt->irs.get();
    auto cleanup_task = make_lambda_task([ctxt=std::move(ctxt)]() mutable {
        DBG_LOG1(DEBUG_PLOT, "CLEANUP TASK called!!! ctxt = %p", ctxt.get());
        ctxt.reset();
    });

    // Create and send back the requested tiles.
    int row_start = irs_ptr->row_start();
    int col_start = irs_ptr->col_start();
    int nrows = irs_ptr->nrows();
    int ncols = irs_ptr->ncols();
    for (int row = row_start; row < row_start + nrows; row++) {
        for (int col = col_start; col < col_start + ncols; col++) {
            int buf_id = irs_ptr->get_buf_id(row, col);
            bool is_prio = irs_ptr->is_priority(row, col);

            if (buf_id == -1) continue;

            TileKey key(req.sm_version, req.canvas.id, req.canvas.zoom_level,
                        row, col, req.item_id);
            DBG_LOG1(DEBUG_PLOT, ">>> Enqueueing tile task for %s (%s) ...",
                     key.debugString().c_str(), (is_prio) ? "prio" : "reg");
            auto iter = inflight_tiles_.find(key);
            CHECK(iter != inflight_tiles_.end());
            InflightTileInfo &info = iter->second;
            CHECK(info.task_ctxt == ctxt_ptr && info.tile_task == nullptr);

            info.task_ctxt = nullptr;
            info.tile_task = ThrManager::enqueue_lambda_no_delete(
                [=]() { draw_tile_task(req, irs_ptr, row, col); },
                (is_prio) ? Task::SCHD_LIFO : Task::SCHD_LIFO_LOW,
                cleanup_task.get()
            );
        }
    }

    ThrManager::enqueue(std::move(cleanup_task));
}

void Plotter::draw_tile_task(const PlotRequest req,
                             const IntersectionResultSet<int64_t> *irs,
                             int row, int col)
{
    const int buf_id = irs->get_buf_id(row, col);
    auto iter = irs->get_iter(buf_id);

    // Might be too big to allocate on stack.
    std::unique_ptr<ColoredBufferBase> tile;
    if (req.is_highlight())
        tile = std::make_unique<RgbaBuffer>();
    else
        tile = std::make_unique<RgbBuffer>(0xffffff);  // white

    for (auto &fd : data_) {
        if (!iter.has_next()) break;

        int64_t next_idx = iter.peek();
        int64_t fd_end = fd->start_atom_idx + fd->atom_cnt;
        if (next_idx < fd_end)
            iter = fd->paint(tile.get(), req, iter, row, col);
    }

    // Create the buffer for PNG file generation.
    std::unique_ptr<UniqueMessageData> png_data =
        tile->make_png_data(util::string_printf("tile-r%d-c%d", row, col));

    std::unique_ptr<UniqueMessageData> hovermap_data;
    if (!req.is_highlight()) {
        hovermap_data = tile->make_hovermap_data(
            util::string_printf("hovermap-r%d-c%d", row, col));
    }

    std::vector<int> seqs;
    {
        std::unique_lock<std::mutex> lck(m_);
        seqs.swap(orphaned_seqs_);

        TileKey key(req.sm_version, req.canvas.id, req.canvas.zoom_level,
                    row, col, req.item_id);
        InflightTileInfo &info = inflight_tiles_.at(key);
        seqs.push_back(info.seq_no);

        sent_tiles_.insert({ info.seq_no, key });
        sent_tile_list_.emplace_back(
            std::make_pair(info.seq_no, util::microtime()));
    }

    // Check if SelectionMap version has changed: if so, mark the version as
    // transient (i.e., odd).
    //
    // TODO: Currently FE isn't actually checking this version number!
    //       (Need to check and re-send the request if the newest version is
    //       missing after a while.)
    int sm_version = sm_->version.load();
    if (sm_version != req.sm_version)
        sm_version = (req.sm_version | 0x01);

    std::vector<std::string> dict{
        "msg=tile",
        "seqs=" + util::join_to_string(seqs, ":"),
        "#sm_version=" + std::to_string(sm_version),
        "#config_id=" + std::to_string(req.canvas.id),
        "#zoom_level=" + std::to_string(req.canvas.zoom_level),
        "#row=" + std::to_string(row),
        "#col=" + std::to_string(col),
    };

    if (req.is_highlight())
        dict.push_back("#item_id=" + std::to_string(req.item_id));

    tmgr_->send_msg(this, dict, std::move(png_data), std::move(hovermap_data));
}

std::pair<int64_t, int64_t> Plotter::get_atom_idxs(int item_id)
{
    // TODO: Use binary search?
    for (auto &fd : data_) {
        int next_start = fd->start_item_id + fd->item_cnt;
        if (item_id < next_start) return fd->get_atom_idxs(item_id);
    }

    DIE_MSG("Invalid item_id - shouldn't come here !!");
}

void Plotter::set_error(const std::string &msg)
{
    if (msg.empty())
        err_msg_ = "Unknown error";
    else
        err_msg_ = msg;
}

} // namespace croquis
