// A task that finds intersections between tiles and line segments.

#include "croquis/intersection_finder.h"

#include <limits.h>  // INT_MAX

#include <algorithm>  // min
#include <memory>  // make_unique

#include "croquis/canvas.h"  // CanvasConfig
#include "croquis/util/macros.h"  // CHECK
#include "croquis/util/stl_container_util.h"  // util::push_back

namespace croquis {

template<typename DType>
IntersectionResult<DType>::IntersectionResult(int tile_cnt,
                                              DType start_id, DType end_id)
    : tile_cnt(tile_cnt), start_id(start_id), end_id(end_id)
{
    // Reserve some extra: `strip_cnt_` is the number of strips in the initial
    // chunk.
    int extra = std::max(5, int(tile_cnt * 0.2));
    strip_cnt_ = tile_cnt + extra;

    chunks_.push_back(std::make_unique<DType[]>(strip_cnt_ * STRIP_SZ));
    strips_ = std::make_unique<DType *[]>(tile_cnt);
    idxs_ = std::make_unique<int[]>(tile_cnt);

    // Initialize pointers.
    DType *ptr = chunks_[0].get();
    for (int i = 0; i < tile_cnt; i++) {
        strips_[i] = ptr;
        idxs_[i] = 0;
        *ptr = -1;  // Sentinel value.
        ptr += STRIP_SZ;
    }

    // Put the extra buffer into `freelist_.`.
    freelist_ = nullptr;
    for (int i = 0; i < extra; i++) {
        *(void **) ptr = freelist_;
        freelist_ = (void *) ptr;
        ptr += STRIP_SZ;
    }
}

template<typename DType>
DType *IntersectionResult<DType>::allocate_chunk()
{
    CHECK(freelist_ == nullptr);

    // printf("allocate_chunk called !!!\n");

    int chunksize = std::min(std::max(20, strip_cnt_ / 2), 1024);
    DType *chunk =
        util::push_back(
            chunks_,
            std::make_unique<DType[]>(chunksize * STRIP_SZ)).get();

    DType *ptr = chunk + STRIP_SZ;
    for (int i = 1; i < chunksize; i++) {
        *(void **) ptr = freelist_;
        freelist_ = (void *) ptr;
        ptr += STRIP_SZ;
    }

    return chunk;
}

template<typename DType>
IntersectionResultSet<DType>::IntersectionResultSet(
    const std::vector<int> &prio_coords,
    const std::vector<int> &reg_coords,
    DType start, DType end, DType batch_size)
{
    // printf("**********************************\n");
    // printf("IntersectionResultSet created %p\n", this);

    CHECK(prio_coords.size() + reg_coords.size() > 0);
    CHECK(prio_coords.size() % 2 == 0);
    CHECK(reg_coords.size() % 2 == 0);

    int row_min = INT_MAX, row_max = INT_MIN;
    int col_min = INT_MAX, col_max = INT_MIN;

    for (size_t i = 0; i < prio_coords.size(); i += 2) {
        row_min = std::min(row_min, prio_coords[i]);
        row_max = std::max(row_max, prio_coords[i]);
        col_min = std::min(col_min, prio_coords[i + 1]);
        col_max = std::max(col_max, prio_coords[i + 1]);
    }

    for (size_t i = 0; i < reg_coords.size(); i += 2) {
        row_min = std::min(row_min, reg_coords[i]);
        row_max = std::max(row_max, reg_coords[i]);
        col_min = std::min(col_min, reg_coords[i + 1]);
        col_max = std::max(col_max, reg_coords[i + 1]);
    }

    // Now fill in the coordinate specification.
    // (We assume that `prio_coords` and `reg_coords` don't intersect.)
    tile_cnt_ = (prio_coords.size() + reg_coords.size()) / 2;
    row_start_ = row_min;
    nrows_ = row_max - row_min + 1;
    col_start_ = col_min;
    ncols_ = col_max - col_min + 1;

    // Compute the mapping from tile coordinate (row, col) to buffer ID for each
    // tile we're using.
    int area_size = nrows_ * ncols_;
    tile_map_ = std::make_unique<int[]>(area_size);
    is_prio_ = std::make_unique<bool[]>(area_size);
    for (int i = 0; i < area_size; i++) {
        tile_map_[i] = -1;
        is_prio_[i] = false;
    }

    for (size_t i = 0; i < prio_coords.size(); i += 2) {
        int idx = (prio_coords[i] - row_start_) * ncols_ +
                  (prio_coords[i + 1] - col_start_);
        CHECK(idx >= 0 && idx < area_size);  // Sanity check.
        CHECK(tile_map_[idx] == -1);  // Sanity check.
        tile_map_[idx] = 0;
        is_prio_[idx] = true;
    }

    for (size_t i = 0; i < reg_coords.size(); i += 2) {
        int idx = (reg_coords[i] - row_start_) * ncols_ +
                  (reg_coords[i + 1] - col_start_);
        CHECK(idx >= 0 && idx < area_size);  // Sanity check.
        CHECK(tile_map_[idx] == -1);  // Sanity check.
        tile_map_[idx] = 0;
    }

    {
        int c = 0;
        for (int i = 0; i < area_size; i++) {
            if (tile_map_[i] == 0) tile_map_[i] = c++;
        }
        CHECK(c == tile_cnt_);
    }

    // Now create the necessary number of IntersectionResult instances.
    CHECK(start <= end);  // Sanity check.
    while (start < end) {
        DType this_size = std::min(end - start, batch_size);
        util::emplace_back_unique(results, tile_cnt_, start, start + this_size);
        start += this_size;
    }
}

// Instantiate necessary templates.
template class IntersectionResult<int64_t>;
template class IntersectionResultSet<int64_t>;

} // namespace croquis
