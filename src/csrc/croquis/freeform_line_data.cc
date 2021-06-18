// Lines made of different numbers of data points each.
//
// TODO: There's a huge amount of duplicate code between this and
//       rectangular_line_data.cc !!

#include "croquis/figure_data.h"

#include <inttypes.h>  // PRId64

#include <algorithm>  // max
#include <tuple>  // tie

#include "croquis/grayscale_buffer.h"  // GrayscaleBuffer
#include "croquis/intersection_finder.h"
#include "croquis/line_algorithm.h"
#include "croquis/rgb_buffer.h"  // ColoredBufferBase
#include "croquis/util/logging.h"  // DBG_LOG1

#define DEBUG_FIG 0

namespace croquis {

Range2D FreeformLineData::range() const
{
    // TODO: Do it on a thread?
    Range2D retval;
    std::tie(retval.xmin, retval.xmax) = X_.minmax();
    std::tie(retval.ymin, retval.ymax) = Y_.minmax();

    return retval;
}

std::pair<int64_t, int64_t> FreeformLineData::get_atom_idxs(int item_id)
{
    int rel_id = item_id - start_item_id;
    int start_idx = start_atom_idx + 2 * (get_start_idx(rel_id));
    int end_idx = start_idx + 2 * get_pts_cnt(rel_id);
    return { start_idx, end_idx };
}

// Runs in the thread pool.
void FreeformLineData::compute_intersection(
         const PlotRequest &req,
         const SelectionMap &sm,
         const IntersectionResultSet<int64_t> *irs,
         IntersectionResult<int64_t> *result)
{
    const CanvasConfig *canvas = req.canvas;

    // Transformation from input coordinates to "tile coordinates".
    CanvasConfig::Transform tr = canvas->get_tile_transform(req.zoom_level);

    float line_width = req.is_highlight() ? highlight_line_width_ : line_width_;
    float tw = line_width / TILE_SIZE;
    float marker_radius = marker_size_ / (2.f * TILE_SIZE);

    // For simplicity, assume line width and marker size is smaller than
    // TILE_SIZE.
    // TODO: Relax this!
    CHECK(tw < 1.0);
    CHECK(marker_radius < 1.0);

    const int64_t batch_start =
        std::max(start_atom_idx, result->start_id);
    const int64_t batch_end =
        std::min(start_atom_idx + atom_cnt, result->end_id);

    DBG_LOG1(DEBUG_FIG,
             "compute_intersection() called: batch_start=%" PRId64 " "
             "batch_end=%" PRId64,
             batch_start, batch_end);

    // Find the starting item ID.
    //  * rel_item_id = (item_id - start_item_id)
    //  * start_idx = start_idxs_[rel_item_id]
    //  * Line #item_id contains of `pts_cnt` points, starting with
    //    (X[start_idx], Y[start_idx]).
    //  * `pt_idx` is a number in range [0, pts_cnt * 2)
    //      - atom_idx == start_atom_idx + 2 * start_idx + pt_idx.
    //      - If pt_idx < pts_cnt - 1, it is a line segment between
    //        (X[i], Y[i]) and (X[i+1], Y[i+1]) where i = (start_idx + pt_idx).
    //      - If pt_idx == pts_cnt - 1, the atom is unused.
    //      - If pt_idx >= pts_cnt, it is a marker at (X[i], Y[i]) where i =
    //        (start_idx + pt_idx - pts_cnt).
    //
    // TODO: Use binary search?
    int rel_item_id, start_idx, pt_idx, pts_cnt;
    for (rel_item_id = 0; rel_item_id < start_idxs_.shape[1]; rel_item_id++) {
        start_idx = get_start_idx(rel_item_id);
        pt_idx = (batch_start - start_atom_idx) - 2 * start_idx;
        pts_cnt = get_pts_cnt(rel_item_id);
        CHECK(pt_idx >= 0);
        if (pt_idx < 2 * pts_cnt) break;
    }
    int64_t atom_idx = batch_start;

    auto do_visit = [=, &atom_idx](int x, int y) {
        int buf_id = irs->get_buf_id(y, x);
        if (buf_id != -1) result->append(buf_id, atom_idx);
    };

    auto visitor = create_straight_line_visitor(
        irs->col_start(), irs->row_start(),
        irs->col_start() + irs->ncols() - 1,
        irs->row_start() + irs->nrows() - 1,
        do_visit);

    while (true) {
        // Find the first selected item starting from `atom_idx`.
        // (For highlight tiles, we do not care about selected items because an
        // item was explicitly requested.)
        if (!req.is_highlight()) {
            while (true) {
                bool selected = sm.m[start_item_id + rel_item_id];
                // DBG_LOG1(DEBUG_FIG, "item #%d selected=%s",
                //          start_item_id + rel_item_id, selected ? "true" : "false");
                if (selected) break;

                rel_item_id++;
                if (rel_item_id >= item_cnt) return;
                start_idx = get_start_idx(rel_item_id);
                pt_idx = 0;
                pts_cnt = get_pts_cnt(rel_item_id);
                atom_idx = start_atom_idx + 2 * start_idx;
                if (atom_idx >= batch_end) return;
            }
        }

        // Pointers to x, y data inside the buffer (X_ and Y_).
        const char *xp, *yp;
        // Values of (x, y) in tile coordinates.
        float tx0, ty0;

        //----------------------------------------
        // Handle line segments (0 <= pt_idx < pts_cnt - 1)

        if (pt_idx < pts_cnt - 1) {
            xp = X_.get(0, start_idx + pt_idx);
            yp = Y_.get(0, start_idx + pt_idx);
            tx0 = X_.get_transformed(xp, tr.xscale, tr.xbias);
            ty0 = Y_.get_transformed(yp, tr.yscale, tr.ybias);
        }

        while (pt_idx < pts_cnt - 1) {
            // Read the next point.
            const char *xp_next = xp + X_.strides[1];
            const char *yp_next = yp + Y_.strides[1];
            float tx1 = X_.get_transformed(xp_next, tr.xscale, tr.xbias);
            float ty1 = Y_.get_transformed(yp_next, tr.yscale, tr.ybias);

#if 0
            printf("batch_start = %ld atom_idx = %ld rel_item_id = %d pt_idx = %d\n",
                   batch_start, atom_idx, rel_item_id, pt_idx);
            printf("  x0 y0 x1 y1 = %.3f %.3f %.3f %.3f\n",
                   *xp, *yp, *xp_next, *yp_next);
#endif

            visitor.visit(tx0, ty0, tx1, ty1, tw);

            xp = xp_next;
            yp = yp_next;
            tx0 = tx1;
            ty0 = ty1;

            if (++atom_idx >= batch_end) return;
            pt_idx++;
        }

        // This ID is unused.
        if (pt_idx == pts_cnt - 1) {
            if (++atom_idx >= batch_end) return;
            pt_idx++;
        }

        //----------------------------------------
        // Handle markers (pts_cnt <= pt_idx < pts_cnt * 2).

        xp = X_.get(0, start_idx + pt_idx - pts_cnt);
        yp = Y_.get(0, start_idx + pt_idx - pts_cnt);

        while (pt_idx < pts_cnt * 2) {
            float tx = X_.get_transformed(xp, tr.xscale, tr.xbias);
            float ty = Y_.get_transformed(yp, tr.yscale, tr.ybias);

            int txi0 = nearbyintf(tx - marker_radius);
            int txi1 = nearbyintf(tx + marker_radius);
            int tyi0 = nearbyintf(ty - marker_radius);
            int tyi1 = nearbyintf(ty + marker_radius);

            do_visit(txi0, tyi0);
            do_visit(txi0, tyi1);
            do_visit(txi1, tyi0);
            do_visit(txi1, tyi1);

            if (++atom_idx >= batch_end) return;
            pt_idx++;
            xp += X_.strides[1];
            yp += Y_.strides[1];
        }

        CHECK(pt_idx == pts_cnt * 2);
        rel_item_id++;
        start_idx = get_start_idx(rel_item_id);
        pt_idx = 0;
        pts_cnt = get_pts_cnt(rel_item_id);
    }
}

// Runs in the thread pool.
FreeformLineData::IrsIter_t
FreeformLineData::paint(ColoredBufferBase *tile, const PlotRequest &req,
                        IrsIter_t iter, int row, int col)
{
    if (!iter.has_next()) return iter;

    const CanvasConfig *canvas = req.canvas;
    const float line_width =
        req.is_highlight() ? highlight_line_width_ : line_width_;

    // Transformation from input to pixel coordinates.
    CanvasConfig::Transform tr = canvas->get_transform(req.zoom_level);
    tr.xbias -= col * TILE_SIZE;
    tr.ybias -= row * TILE_SIZE;

    auto gray_buf = std::make_unique<GrayscaleBuffer>();

    // Remember `item_id` of the previous atom so that we can reuse `gray_buf`
    // for parts of the same line.
    // TODO: Handle the case when each segment of the same line has different
    //       colors!
    int prev_id = -1;

    // Find the starting item ID: see the comments at compute_intersection().
    int64_t atom_idx = iter.peek();
    int rel_item_id, start_idx, pt_idx, pts_cnt;
    for (rel_item_id = 0; rel_item_id < start_idxs_.shape[1]; rel_item_id++) {
        start_idx = get_start_idx(rel_item_id);
        pt_idx = (atom_idx - start_atom_idx) - 2 * start_idx;
        pts_cnt = get_pts_cnt(rel_item_id);
        CHECK(pt_idx >= 0);
        if (pt_idx < 2 * pts_cnt) break;
    }

    while (true) {
        if (!iter.has_next() || iter.peek() >= start_atom_idx + atom_cnt) break;
        atom_idx = iter.get_next();

        // Keep `rel_item_id` and others in sync with `atom_idx`.
        while (true) {
            pt_idx = (atom_idx - start_atom_idx) - 2 * start_idx;
            if (pt_idx < 2 * pts_cnt) break;

            rel_item_id++;
            CHECK(rel_item_id < item_cnt);  // Sanity check.
            start_idx = get_start_idx(rel_item_id);
            pts_cnt = get_pts_cnt(rel_item_id);
        }

        if (prev_id != -1 && prev_id != rel_item_id) {
            CHECK(prev_id < rel_item_id);
            uint32_t color = colors_.get_argb(prev_id);
            // DBG_LOG1(DEBUG_FIG, "(%d %d) tile merge: %08x\n", row, col, color);
            tile->merge(gray_buf.get(), start_item_id + prev_id, color);
        }
        prev_id = rel_item_id;

        if (pt_idx < pts_cnt - 1) {
            // Draw a line.
            const char *xp0 = X_.get(0, start_idx + pt_idx);
            const char *yp0 = Y_.get(0, start_idx + pt_idx);
            const char *xp1 = xp0 + X_.strides[1];
            const char *yp1 = yp0 + Y_.strides[1];

            const float x0 = X_.get_transformed(xp0, tr.xscale, tr.xbias);
            const float y0 = Y_.get_transformed(yp0, tr.yscale, tr.ybias);
            const float x1 = X_.get_transformed(xp1, tr.xscale, tr.xbias);
            const float y1 = Y_.get_transformed(yp1, tr.yscale, tr.ybias);

#if 0
            if (fabs(x0) > 1e6 || fabs(y0) > 1e6 ||
                fabs(x1) > 1e6 || fabs(y1) > 1e6) {
                DBG_LOG1(DEBUG_FIG,
                    "(%d, %d) Drawing line [#%zu]: "
                    "data coord: (%.2f, %.2f)--(%.2f, %.2f) "
                    "pixel coord: (%.2f, %.2f)--(%.2f, %.2f) line_width=%.2f",
                    row, col, atom_idx, *xp0, *yp0, *xp1, *yp1,
                    x0, y0, x1, y1, line_width);
            }
#endif

            gray_buf->draw_line(x0, y0, x1, y1, line_width);
        }
        else if (pt_idx >= pts_cnt) {
            // Draw a marker.
            const char *xp0 = X_.get(0, start_idx + pt_idx - pts_cnt);
            const char *yp0 = Y_.get(0, start_idx + pt_idx - pts_cnt);

            const float x0 = X_.get_transformed(xp0, tr.xscale, tr.xbias);
            const float y0 = Y_.get_transformed(yp0, tr.yscale, tr.ybias);

            gray_buf->draw_circle(x0, y0, marker_size_ * .5f);
        }
    }

    if (prev_id != -1) {
        uint32_t color = colors_.get_argb(prev_id);
        // DBG_LOG1(DEBUG_FIG, "(%d %d) final tile merge: %08x\n", row, col, color);
        tile->merge(gray_buf.get(), start_item_id + prev_id, color);
    }

    return iter;
}

} // namespace croquis
