// The canvas.

#pragma once

#include <math.h>  // pow
#include <string.h>  // memset

#include <atomic>
#include <functional>  // hash
#include <memory>  // unique_ptr
#include <string>
#include <unordered_map>
#include <vector>

#include "croquis/constants.h"  // ZOOM_FACTOR
#include "croquis/util/myhash.h"
#include "croquis/util/string_printf.h"

namespace croquis {

// Key to find a tile.
class TileKey {
  public:
    // SelectionMap::version when the construction of this tile started.
    int sm_version;

    int config_id;
    int zoom_level;

    // Relative position.
    // x offset (in pixels) = col * TILE_SIZE.
    // y offset (in pixels) = row * TILE_SIZE.
    int row, col;
    int item_id;  // -1 if not a highlight tile.

    TileKey(int sm_version, int config_id, int zoom_level,
            int row, int col, int item_id)
        : sm_version(sm_version), config_id(config_id), zoom_level(zoom_level),
          row(row), col(col), item_id(item_id) { }

    bool operator==(const TileKey &b) const {
        return sm_version == b.sm_version &&
               config_id == b.config_id &&
               zoom_level == b.zoom_level &&
               row == b.row &&
               col == b.col &&
               item_id == b.item_id;
    }

    // For debugging.
    std::string debugString() const {
        if (item_id == -1) {
            return util::string_printf(
                       "[%d]%d:%d:%d:%d",
                       sm_version, config_id, zoom_level, row, col);
        }
        else {
            return util::string_printf(
                       "[%d]%d:%d:%d:%d:%d",
                       sm_version, config_id, zoom_level, row, col, item_id);
        }
    }
};

#if 0
// Hold information about a single tile.
class Tile {
  public:
    // enum Status { PENDING = 0, READY = 1 } status = PENDING;

    int config_id;
    int zoom_level;
    int row, col;

    std::vector<int> intersects;  // Which dataset intersects this tile.
    std::unique_ptr<char[]> bitmap;  // The generated image data.

    Tile(int config_id, int zoom_level, int row, int col)
        : config_id(config_id), zoom_level(zoom_level), row(row), col(col)
    { }
};
#endif

} // namespace croquis

// Hash functors.
namespace std {

template<> struct hash<::croquis::TileKey>
{
    typedef ::croquis::TileKey argument_type;
    typedef size_t result_type;

    size_t operator()(const ::croquis::TileKey &key) const
    {
        size_t hashval = (size_t) key.sm_version;
        hashval = ::croquis::util::hash_combine(hashval, key.config_id);
        hashval = ::croquis::util::hash_combine(hashval, key.zoom_level);
        hashval = ::croquis::util::hash_combine(hashval, key.row);
        hashval = ::croquis::util::hash_combine(hashval, key.col);
        hashval = ::croquis::util::hash_combine(hashval, key.item_id);
        return hashval;
    }
};

}  // namespace std

namespace croquis {

// A particular configuration of a canvas: i.e., its size and coordinates.
//
// We don't want to just store the corner coordinates in floating point, because
// if we pan the canvas in one direction and later come back, we want to be able
// to come back to the previous coordinates, in order to reuse tiles.
//
// Toward this goal, we add zoom level and offset to each tile.  As long as the
// user uses standard zoom/pan buttons, they will be stay inside the same
// CanvasConfig.
//
// In the simplest case, given the data (input) coordinate `x`, the
// corresponding "pixel" coordinate `px` is:
//      x = x0 -> px = 0     (center of the leftmost pixel)
//      x = x1 -> px = w - 1 (center of the rightmost pixel)
//
// In addition, we want to allow a zoom factor Z, such that the midpoint
// (x = (x0+x1)/2) remains at the middle of the canvas (px = (w-1)/2).  Hence:
//      px = (w-1) * (Z * (x - (x0+x1)/2) / (x1-x0) + 1/2).
//
// Here the zoom factor Z is defined as pow(ZOOM_FACTOR = 1.5, zoom_level).
//
// Conversely,
//      x = (x0+x1)/2 + (x1-x0) / Z * ( px/(w-1) - 1/2 ).
//
// The equation for y coordinate is the same, except that it's "inverted":
//      y = y0 -> py = h - 1 (center of the bottom pixel)
//      y = y1 -> py = 0     (center of the top pixel)
//
// Hence,
//      py = (h-1) * (Z * (y - (y0+y1)/2) / (y0-y1) + 1/2),
//      y = (y0+y1)/2 + (y0-y1) / Z * ( py/(h-1) - 1/2 ).
//
// See also Plotter::compute_intersection_task().
class CanvasConfig {
  public:
    // Config ID, starting with zero (the initial configuration).
    // Each tile has config ID to indicate which coordinate system it uses.
    int id;
    int w, h;  // width and height of the canvas, in pixels.
    double x0, y0, x1, y1;

    // Technically, these are not part of the "canvas config" but rather the
    // exact current state of FE: changing these values won't change the config
    // ID.  But because we frequently need these values as well, it's convenient
    // to keep them in the same class.
    //
    // See messages.txt for details.
    int zoom_level;
    int x_offset, y_offset;  // Offset after panning, in pixel coordinates.

    CanvasConfig(int id, int w, int h,
                 double x0, double y0, double x1, double y1,
                 int zoom_level = 0, int x_offset = 0, int y_offset = 0)
        : id(id), w(w), h(h), x0(x0), y0(y0), x1(x1), y1(y1),
          zoom_level(zoom_level), x_offset(x_offset), y_offset(y_offset) { }

    struct Point { double x, y; };

    Point get_data_coord(double px, double py) const {
        Point pt;

        double inv_zoom = pow(ZOOM_FACTOR, -zoom_level);
        pt.x = (x0 + x1) * 0.5 + (x1 - x0) * inv_zoom * (px / (w - 1) - 0.5);
        pt.y = (y0 + y1) * 0.5 + (y0 - y1) * inv_zoom * (py / (h - 1) - 0.5);

        return pt;
    }

    struct Transform {
        float xscale, xbias, yscale, ybias;
    };

    Transform get_transform() const {
        Transform t;

        double zoom = pow(ZOOM_FACTOR, zoom_level);
        t.xscale = zoom * ((w - 1) / (x1 - x0));
        t.xbias = -t.xscale * (x0 + x1) / 2 + w * 0.5 - 0.5;
        t.yscale = zoom * ((h - 1) / (y0 - y1));
        t.ybias = -t.yscale * (y0 + y1) / 2 + h * 0.5 - 0.5;

        return t;
    }

    // Get transformation for tile coordinates.
    //
    // Each tile is made of 256*256 pixels (256 = TILE_SIZE = TS).  To keep the
    // code consistent, we assume that the middle of the tile has integer
    // coordinates.  E.g., tile #(0, 0) is made of coordinates [-0.5, 0.5] x
    // [0.5, 0.5], which corresponds to pixel coordinates [-0.5, 255.5] x [-0.5,
    // 255.5].  Hence,
    //      tx = (px - 127.5) / 256 = (px - (TS-1)/2) / TS.
    //
    // Combining them,
    //      xscale = (Z * (w-1)) / (TS * (x1-x0)),
    //      tx = xscale * x - xscale * (x0+x1)/2 + w / (2*TS) - 1/2.
    Transform get_tile_transform() const {
        Transform t;

        double zoom = pow(ZOOM_FACTOR, zoom_level);
        t.xscale = (zoom / TILE_SIZE) * ((w - 1) / (x1 - x0));
        t.xbias = -t.xscale * (x0 + x1) * 0.5 + w / (2. * TILE_SIZE) - 0.5;
        t.yscale = (zoom / TILE_SIZE) * ((h - 1) / (y0 - y1));
        t.ybias = -t.yscale * (y0 + y1) * 0.5 + h / (2. * TILE_SIZE) - 0.5;

        return t;
    }
};

// Stores information about which items are currently enabled for drawing.
// (Initially all items are selected.)
//
// The data is only updated by Python code, in response to FE message: it
// acquires a (Python) mutex, calls start_update() to start update, directly
// updates data, and calls end_update() to indicate the update is done.
//
// `version` is even if update is finished; otherwise an update is ongoing.
//
// Any concurrently running C++ tasks can read the value of `version` at the
// beginning/end: if the values are the same (and even) then we know we used
// consistent values from SelectionMap.
class SelectionMap {
  public:
    const size_t sz;
    std::atomic<int> version{0};

    // Remember whether each item is enabled.
    std::unique_ptr<volatile bool[]> m;

    explicit SelectionMap(size_t sz)
        : sz(sz), m(std::make_unique<volatile bool[]>(sz))
    {
        memset((void *) m.get(), 0x01, sz);
    }

    // Start update: this function must be called with (Python) mutex held.
    void start_update() { version.fetch_add(1); }

    // End update: this function must be called with (Python) mutex held.
    void end_update(int new_version) { version.store(new_version); }
};

} // namespace croquis
