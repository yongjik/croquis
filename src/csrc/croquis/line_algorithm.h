// Template helper functions for drawing lines.

#pragma once

#include <math.h>  // isnan
#include <stdio.h>  // printf (for debugging)

#include <algorithm>  // max

#include "croquis/util/logging.h"  // DBG_LOG1

namespace croquis {

// Draw a straigh line from (x0, y0) to (x1, y1), and "visit" all pixels on the
// line by calling the visitor function.
//
// In order to "reuse" the same algorithm as GrayscaleBuffer, we assume each
// pixel is centered at integer coordinates: for example, the pixel centered at
// the origin (0, 0) contains points [-0.5, 0.5] x [0.5, 0.5].
//
// We will not be too concerned about what happens when the line segment passes
// through the corner or stops exactly at the edge.
//
// TODO: Expand templates and support `double` as well?
template<typename F>
class StraightLineVisitor {
  private:
    const int xmin_, ymin_, xmax_, ymax_;
    const F fn_;

  public:
    StraightLineVisitor(int xmin, int ymin, int xmax, int ymax, F fn)
        : xmin_(xmin), ymin_(ymin), xmax_(xmax), ymax_(ymax),
          fn_(fn) { }

    inline void visit(float x0, float y0, float x1, float y1, float width);
};

// Most of the logic is copied from GrayscaleBuffer::draw_line().
// See there for detailed comments.
template<typename F>
inline void StraightLineVisitor<F>::visit(
                float x0, float y0, float x1, float y1, float width)
{
#if 0
    printf("visit(x0 y0 x1 y1 width = %.3f %.3f %.3f %.3f %.3f\n",
           x0, y0, x1, y1, width);
#endif

    if (isnan(x0) || isnan(y0) || isnan(x1) || isnan(y1)) return;

    const float dx = x1 - x0;
    const float dy = y1 - y0;

    // Shift by (xmin_, ymin_) so that the boundary starts at the origin.
    // If we "flip" the coordinate, shift by (xmax_, ymax_) so that, again, the
    // boundary starts at the origin.
    float coords0[8] = {
        x0 - xmin_, x1 - xmin_, y0 - ymin_, y1 - ymin_,
        xmax_ - x0, xmax_ - x1, ymax_ - y0, ymax_ - y1,
    };
    int coord_type =
        4 * (fabsf(dy) > fabsf(dx)) +  // bit 2: steep slope
        2 * (y0 > y1) +                // bit 1: y0 > y1
        1 * (x0 > x1);                 // bit 0: x0 > x1

    const int FLIP = 4;
    static const int coord_shuffle_map[] = {
        0, 1, 2, 3,
        1, 0, FLIP+3, FLIP+2,
        0, 1, FLIP+2, FLIP+3,
        1, 0, 3, 2,

        2, 3, 0, 1,
        2, 3, FLIP+0, FLIP+1,
        3, 2, FLIP+1, FLIP+0,
        3, 2, 1, 0,
    };

    float coords[4];
    for (int i = 0; i < 4; i++)
        coords[i] = coords0[coord_shuffle_map[coord_type * 4 + i]];

    const float u0 = coords[0];
    const float u1 = coords[1];
    const float v0 = coords[2];
    const float v1 = coords[3];
    const float du = u1 - u0;
    const float dv = v1 - v0;

    //  0: no transformation          (u = x - xmin_, v = y - ymin_)
    //  1: flip y                     (u = x - xmin_, v = ymax_ - y)
    //  2: transpose                  (u = y - ymin_, v = x - xmin_)
    //  3: flip x, and then transpose (u = y - ymin_, v = xmax_ - x)
    int shuffle_type = (coord_type >> 1) ^ (coord_type & 0x01);

    // Draw area limit.
    const int area_width =
        (shuffle_type >= 2) ? ymax_ - ymin_ + 1 : xmax_ - xmin_ + 1;
    const int area_height =
        (shuffle_type >= 2) ? xmax_ - xmin_ + 1 : ymax_ - ymin_ + 1;

    const float len = sqrt(dx * dx + dy * dy);
    if (len == 0.0) return;  // No line to draw.
    const float invlen = 1.0f / len;
    const float wu = dv * (invlen * width / 2);
    const float wv = du * (invlen * width / 2);

    const float umin = u0 - wu;
    const float vmin = v0 - wv;

    const float slope = dv / du;

    // vL0: where the lower line intersects the left side of the leftmost pixel
    //      (u = -0.5).
    // vH0: where the higher line intersects the *right* side of the leftmost
    //      pixel (u = +0.5).
    float vL0 = (v0 - wv) + slope * (-0.5 - (u0 + wu));
    float vH0 = (v0 + wv) + slope * (+0.5 - (u0 - wu));

    // Find the first column to visit.
    int u;
    if (umin > -0.5f && vmin > -0.5f) {
        // If (umin, vmin) is inside the drawing area, we can start from there.
        u = nearbyintf(umin);
    }
    else {
        // The line starts outside the drawing area.
        if (vH0 > -0.5f) {
            // If vH0 >= -0.5, then the higher line passes at or above the pixel
            // (0, 0).  Hence, we can start drawing at u=0.
            u = 0;
        }
        else {
            // If the higher line passes below (0, 0), then find the
            // u-coordinate when v equals -0.5 (i.e., when it enters a pixel in
            // the bottom row).  To guard against overflow, let's first check if
            // the pixel is to the right of the drawing area, in which case
            // there's nothing to draw.
            if (slope * (area_width + 1 - (u0 - wu)) < -0.5f - (v0 + wv)) return;
            const float uH = (u0 - wu) + (-0.5f - (v0 + wv)) / (slope + 1e-8);
            u = nearbyintf(uH);
        }
    }

    const int umax_int = std::min((int) nearbyintf(u1 + wu), area_width - 1);
    const int vmin_int = std::max((int) nearbyintf(v0 - wv), 0);
    const int vmax_int = std::min((int) nearbyintf(v1 + wv), area_height - 1);

    // if (umax_int - u > 10)
    //     DBG_LOG1(1, "u = %d umax_int = %d\n", u, umax_int);

    for (; u <= umax_int; u++) {
        int vL = std::max((int) nearbyintf(vL0 + slope * u), vmin_int);
        int vH = std::min((int) nearbyintf(vH0 + slope * u), vmax_int);
        if (vL > vH) return;  // Only happens if (vL >= area_height).

        // if (vL <= vH - 2) DBG_LOG1(1, "  u = %d vL = %d vH = %d\n", u, vL, vH);

        for (int v = vL; v <= vH; v++) {
            // TODO: Change to branch-less code?
            switch (shuffle_type) {
                case 0: fn_(u + xmin_, v + ymin_); break;
                case 1: fn_(u + xmin_, ymax_ - v); break;
                case 2: fn_(v + xmin_, u + ymin_); break;
                case 3: fn_(xmax_ - v, u + ymin_); break;
            }
        }
    }
}

// Helper function.
template<typename F>
StraightLineVisitor<F> create_straight_line_visitor(
                           int xmin, int ymin, int xmax, int ymax, F fn) {
    return StraightLineVisitor<F>(xmin, ymin, xmax, ymax, fn);
}

} // namespace croquis
