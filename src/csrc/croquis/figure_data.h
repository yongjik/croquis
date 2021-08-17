// The figure data (the set of data added with one Python API call.)
// The final figure (managed by Plotter) can contain multiple figure data.

#pragma once

#include <inttypes.h>  // PRId64
#include <math.h>  // fmin, NAN
#include <stdint.h>  // int64_t, INT32_MAX

#include <utility>  // pair

#include "croquis/buffer.h"  // Buffer2D
#include "croquis/canvas.h"  // CanvasConfig
#include "croquis/intersection_finder.h"
#include "croquis/util/error_helper.h"  // throw_value_error
#include "croquis/util/macros.h"  // DISALLOW_COPY_AND_MOVE

namespace croquis {

class ColoredBufferBase;

struct Range2D {
    double xmin, ymin, xmax, ymax;

    Range2D()
        : xmin(NAN), ymin(NAN), xmax(NAN), ymax(NAN) { }

    // NOTE: According to the standard, if either argument is NaN, fmin/fmax
    // chooses the non-NaN value.
    void merge(Range2D b) {
        xmin = fmin(xmin, b.xmin);
        ymin = fmin(ymin, b.ymin);
        xmax = fmax(xmax, b.xmax);
        ymax = fmax(ymax, b.ymax);
    }
};

// Helper class to keep context for multiple tasks easily.
// This structure is passed by value for tasks, so it must be small.
struct PlotRequest {
    const int sm_version;
    const CanvasConfig canvas;
    const int item_id;  // -1 to draw all.

    PlotRequest(int sm_version, const CanvasConfig canvas, int item_id)
        : sm_version(sm_version), canvas(canvas), item_id(item_id) { }

    bool is_highlight() const { return (item_id != -1); }
};

// An abstract class that holds the figure data passed by Python API.
class FigureData {
  public:
    const int start_item_id;
    const int item_cnt;
    const int64_t start_atom_idx;
    const int64_t atom_cnt;

    FigureData(int start_item_id, int item_cnt,
               int64_t start_atom_idx, int64_t atom_cnt)
        : start_item_id(start_item_id), item_cnt(item_cnt),
          start_atom_idx(start_atom_idx), atom_cnt(atom_cnt)
    { }

    virtual ~FigureData() { }

    // Return the x/y range of this data.
    virtual Range2D range() const = 0;

    // Return { start_atom_idx, end_atom_idx } of a given item.
    // `item_id` must be between [start_item_id, start_item_id + item_cnt).
    virtual std::pair<int64_t, int64_t> get_atom_idxs(int item_id) = 0;

    // Fill in the intersection information.
    // Called by Plotter::compute_intersection_task() - must be thread-safe.
    virtual void compute_intersection(
                     const PlotRequest &req,
                     const SelectionMap &sm,
                     const IntersectionResultSet<int64_t> *irs,
                     IntersectionResult<int64_t> *result) = 0;

    // Paint the plot for tile (row, col) on top of `tile` which may contain
    // plots of preceding FigureData, if any.
    //
    // Called by Plotter::draw_tile_task() - must be thread-safe.
    typedef IntersectionResultSet<int64_t>::Iterator IrsIter_t;
    virtual IrsIter_t paint(ColoredBufferBase *tile, const PlotRequest &req,
                            IrsIter_t iter, int row, int col) = 0;
};

// Lines made of a rectangular array of 2-D points.
//
// It's not completely trivial to handle a "joint", that is, a data point
// where to line segments meet.  For example, imagine the vertex (marked
// "+") of a rectangle, with line width == 3:
//
//  Horizontal line:    Vertical line:      Together:
//      ****** ...                              ****** ...
//      +***** ...         *+*                 *+***** ...
//      ****** ...         ***                 ******* ...
//                         ***                 ***
//                         ***                 ***
//                         ...                 ...
//
// Doing it naively, we end up with a chipped corner.  It seems the easiest
// solution is simply to draw a circle (with the same diameter) on top of
// each point, so that's what we will do.
//
// It also means that even if the caller disabled "markers" we will still
// draw them - with the same color and size as the line itself.
//
// TODO: Maybe we don't need markers if line width == 1?
//
// To handle them correctly, we give a unique ID to each data point
// ("marker") and also each segment between them.  To handle the case the
// caller did specify marker style, markers should have higher IDs (so that
// it paints over the lines).  For example, if X and Y have shape of (3, 4)
// (i.e., three lines with four points each):
//
//      line 0: x-------x-------x-------x
//      ID:         0       1       2       (3 is unused)
//              4       5       6       7
//
//      line 1: x-------x-------x-------x
//      ID:         8       9      10      (11 is unused)
//             12      13      14      15
//
//      line 2: x-------x-------x-------x
//      ID:        16      17      18      (19 is unused)
//             20      21      22      23
class RectangularLineData : public FigureData {
  private:
    const GenericBuffer2D X_;
    const GenericBuffer2D Y_;
    const GenericBuffer2D colors_;

    const int pts_cnt_;

    const float marker_size_;
    const float line_width_;
    // TODO: Also add highglight_marker_size_?
    const float highlight_line_width_;

  public:
    RectangularLineData(int next_item_id, int64_t next_atom_idx,
                        const py::buffer_info &X,
                        const py::buffer_info &Y,
                        const py::buffer_info &colors,
                        int item_cnt, int pts_cnt,
                        float marker_size, float line_width,
                        float highlight_line_width)
        : FigureData(next_item_id, item_cnt,
                     next_atom_idx, ((int64_t) item_cnt) * pts_cnt * 2),
          X_("X", X), Y_("Y", Y),
          colors_("colors", colors, GenericBuffer2D::COLOR),
          pts_cnt_(pts_cnt),
          marker_size_(marker_size), line_width_(line_width),
          highlight_line_width_(highlight_line_width)
    { }

    ~RectangularLineData() { }

    Range2D range() const override;
    std::pair<int64_t, int64_t> get_atom_idxs(int item_id) override;
    void compute_intersection(const PlotRequest &req,
                              const SelectionMap &sm,
                              const IntersectionResultSet<int64_t> *irs,
                              IntersectionResult<int64_t> *result) override;
    IrsIter_t paint(ColoredBufferBase *tile, const PlotRequest &req,
                    IrsIter_t iter, int row, int col) override;

    DISALLOW_COPY_AND_MOVE(RectangularLineData);
};

// Similar as RectangularLineData, but instead of holding a rectangular 2-D
// block of points, each line may have different lengths.
class FreeformLineData : public FigureData {
  private:
    // `X_`, `Y_`, `start_idxs_` are actually 1-D buffers:
    // `X_` and `Y_` must have shape (1, # of points);
    // `start_idxs_` has shape (1, # of lines).
    const GenericBuffer2D X_;
    const GenericBuffer2D Y_;
    const GenericBuffer2D start_idxs_;
    const GenericBuffer2D colors_;

    const int64_t total_pts_cnt_;

    const float marker_size_;
    const float line_width_;
    // TODO: Also add highglight_marker_size_?
    const float highlight_line_width_;

  public:
    FreeformLineData(int next_item_id, int64_t next_atom_idx,
                     const py::buffer_info &X,
                     const py::buffer_info &Y,
                     const py::buffer_info &start_idxs,
                     const py::buffer_info &colors,
                     int item_cnt, int64_t total_pts_cnt,
                     float marker_size, float line_width,
                     float highlight_line_width)
        : FigureData(next_item_id, item_cnt, next_atom_idx, total_pts_cnt * 2),
          X_("X", X), Y_("Y", Y),
          start_idxs_("start_idxs", start_idxs, GenericBuffer2D::INTEGER_TYPE),
          colors_("colors", colors, GenericBuffer2D::COLOR),
          total_pts_cnt_(total_pts_cnt),
          marker_size_(marker_size), line_width_(line_width),
          highlight_line_width_(highlight_line_width)
    { }

    ~FreeformLineData() { }

    Range2D range() const override;
    std::pair<int64_t, int64_t> get_atom_idxs(int item_id) override;
    void compute_intersection(const PlotRequest &req,
                              const SelectionMap &sm,
                              const IntersectionResultSet<int64_t> *irs,
                              IntersectionResult<int64_t> *result) override;
    IrsIter_t paint(ColoredBufferBase *tile, const PlotRequest &req,
                    IrsIter_t iter, int row, int col) override;

  private:
    // Helper function: return the number of points in the given item ID.
    // We naively(?) assume that each line contains at most 2G points.
    int get_pts_cnt(int rel_item_id) const {
        int64_t next = (rel_item_id < item_cnt - 1)
                           ? get_start_idx(rel_item_id + 1) : total_pts_cnt_;
        int64_t cnt = next - get_start_idx(rel_item_id);
        if (cnt < 0 || cnt > INT32_MAX) {
            util::throw_value_error(
                "Number of points for line #%d out of range (%" PRId64 ").",
                rel_item_id, cnt);
        }

        return cnt;
    }

    // Helper function for accessing start_idxs_.
    int64_t get_start_idx(int rel_item_id) const
    { return start_idxs_.get_intval(0, rel_item_id, total_pts_cnt_); }

    DISALLOW_COPY_AND_MOVE(FreeformLineData);
};

} // namespace croquis
