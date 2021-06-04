// A task that finds intersections between tiles and line segments.
//
// Given a set of tiles, we scan through all plot data - for each tile, we
// create the ordered list of all line segments that intersect that tile.

#pragma once

#include <assert.h>
#include <stdint.h>  // uint64_t

#include <memory>  // unique_ptr
#include <vector>

#include "croquis/canvas.h"  // Tile

namespace croquis {

class CanvasConfig;

// Forward declaration.
template<typename DType> class IntersectionResultSet;

// Buffer to hold the list of elements (line segments or points (= "markers"))
// that intersect each tile we want to create.  Each element is represented by a
// unique integer ID (DType), which is either int32_t or int64_t.
//
// An IntersectionResult instance has one output buffer per tiles being
// processed.  This class is not thread-safe, so we need as many
// IntersectionResult instances as the number of intersection tasks.  Each
// (tile-specific) buffer consists of one or more "strips" of 1024 elements
// each - the latest one is the "current strip" where element ID's are being
// appended.  When the current strip is full, we allocate another strip from the
// freelist, and write down its address at the end of the preceding strip.
//
// For now, I'm making it a templated class in case we want to support int32_t
// later (which would cut memory usage by half), but for now we will assume that
// DType is always int64_t.
//
// We assume that each element ID is less than 2**47 (= 128 trillion): we shift
// the value by 16 bits and use the lower 16 bits to store the length of
// consecutive IDs (up to 65535).  E.g., a run "0 1 2 3 32 64 65" can be
// represented as:
//      0x0000 0000 0000 0004 - 4 elements starting at 0
//      0x0000 0000 0020 0001 - 1 element starting at 32
//      0x0000 0000 0040 0002 - 2 elements starting at 64
//
// Appending a value that equals the last added value is a no-op.
//
// Value 0 means end of buffer.  A negative value `v` holds a pointer to the
// next strip, which can be obtained by ((-v) << 3).  (It's possible because the
// pointer must be aligned to 64-bit boundaries.)
//
// To simplify append(), the very first value of a buffer is a sentinel (-1):
// it should be skipped while reading.
//
// TODO: Do we need int32_t?  Let's only use int64_t for now...
template<typename DType> class IntersectionResult {
  public:
    enum { STRIP_SZ = 1024 };  // # of elements in each strip.
    const int tile_cnt;

    // This object only contains items in [start_id, end_id).
    const DType start_id, end_id;

  private:
    // To reduce overhead, strips are contained in "chunks" - each chunk may
    // hold multiple buffers.  We own all the chunks.
    std::vector<std::unique_ptr<DType[]>> chunks_;

    int strip_cnt_;  // Number of strips we have (including filled and free).

    // Points to the strip used by each buffer: the next data for buffer #k is
    // written at strips_[k][idxs_[k]].
    std::unique_ptr<DType *[]> strips_;
    std::unique_ptr<int[]> idxs_;

    // Points to the next free buffer.  The first 8 bytes of that buffer points
    // to the second next free buffer, and so on.
    void *freelist_;

  public:
    IntersectionResult(int tile_cnt, DType start_id, DType end_id);

    inline void append(int buf_id, DType d);

    // Called after we added all data.
    void finish() {
        for (int i = 0; i < tile_cnt; i++) strips_[i][idxs_[i] + 1] = 0;
    }

    class Iterator {
      private:
        DType *ptr_;
        DType next_;

        friend class IntersectionResult;
        friend class IntersectionResultSet<DType>;

        Iterator(DType *ptr, DType next) : ptr_(ptr), next_(next) { }

      public:
        bool has_next() const { return ptr_ != nullptr; }
        inline DType get_next();
        DType peek() const { return next_; }
    };

    // Create an iterator: must be called after finish().
    inline Iterator get_iter(int buf_id);

  private:
    // Slow path for append() - allocate one more chunk and return the first
    // strip (and put the rest to `freelist_`).
    DType *allocate_chunk();
};

template<> inline void IntersectionResult<int64_t>::append(int buf_id, int64_t d)
{
    // printf("IntersectionResult::append called %d %ld !!!\n", buf_id, d);

    assert(d >= start_id && d < end_id);

    typedef int64_t DType;
    DType *strip = strips_[buf_id];

    int idx = idxs_[buf_id];
    int64_t val = strip[idx];

    // Check if the value equals last added value.
    if ((val >> 16) + (val & 0xffff) == d + 1) return;

    // Check if we can extend an existing run.
    //
    // Note that the condition will always fail if append() is called the very
    // first time for a buffer, because then (vall == -1) and (d >= 0).
    if ((val >> 16) + (val & 0xffff) == d && (val & 0xffff) != 0xffff) {
        strip[idx] = val + 1;
        return;
    }

    if (idx < STRIP_SZ - 2) {
        idxs_[buf_id] = idx + 1;
        strip[idx + 1] = (d << 16) + 0x0001;
        return;
    }

    // printf("IntersectionResult::append new strip !!!\n");

    DType *newbuf = (DType *) freelist_;
    if (newbuf == nullptr)
        newbuf = allocate_chunk();  // Slow path.
    else
        freelist_ = *(void **) freelist_;

    // Save link to the new strip.
    strip[idx + 1] = -((uint64_t) newbuf >> 3);

    strips_[buf_id] = newbuf;
    idxs_[buf_id] = 0;
    newbuf[0] = (d << 16) + 0x0001;
}

template<> inline IntersectionResult<int64_t>::Iterator
IntersectionResult<int64_t>::get_iter(int buf_id)
{
    int64_t *ptr;

    ptr = chunks_[0].get() + (buf_id * STRIP_SZ) + 1;
    int64_t d = *ptr;
    if (d == 0)
        return Iterator(nullptr, 0);
    else
        return Iterator(ptr, d >> 16);
}

template<> inline int64_t IntersectionResult<int64_t>::Iterator::get_next()
{
    int64_t retval = next_;
    int64_t rle_end = (*ptr_ >> 16) + (*ptr_ & 0xffff);
    if (++next_ < rle_end)
        return retval;

    int64_t d = *(++ptr_);
    if (d == 0) {
        // End of data.
        ptr_ = nullptr;
    }
    else {
        if (d < 0) {
            // End of current strip: go to the next strip.
            ptr_ = (int64_t *) ((-d) << 3);
        }
        next_ = *ptr_ >> 16;
    }

    return retval;
}

// A collection of IntersectionResult's for parallel processing: each
// IntersectionResult in the vector is processed by its own task.
//
// Currently, this doesn't actually *compute* IntersectionResult's, because it
// depends on the format of the input data - so the computation itself is
// handled by Plotter, which enqueues computation tasks for each
// IntersectionResult.
//
// TODO: Find a better name?
template<typename DType> class IntersectionResultSet {
  private:
    // Set up by the constructor.
    int tile_cnt_;
    int row_start_, col_start_, nrows_, ncols_;

    std::unique_ptr<int[]> tile_map_;
    std::unique_ptr<bool[]> is_prio_;

  public:
    std::vector<std::unique_ptr<IntersectionResult<DType>>> results;

    // `prio_coords` (for "priority tiles") and `reg_coords` (for lower priority
    // tiles) are even-length vectors of tile coordinates (row, col).  We use
    // their data to fill in `tile_map_`.
    //
    // The caller is free to discard `prio_coords` and `reg_coords` after the
    // constructor returns.
    IntersectionResultSet(const std::vector<int> &prio_coords,
                          const std::vector<int> &reg_coords,
                          DType start, DType end, DType batch_size);

//  ~IntersectionResultSet() {
//      printf("******************************************************\n");
//      printf("IntersectionResultSet destroyed %p BLAH!!!!!!!!!!\n", this);
//  }

    int row_start() const { return row_start_; }
    int col_start() const { return col_start_; }
    int nrows() const { return nrows_; }
    int ncols() const { return ncols_; }

    // Given row and col, get the buffer ID (-1 if we don't have it).
    int get_buf_id(int row, int col) const {
        if (row >= row_start_ && row < row_start_ + nrows_ &&
            col >= col_start_ && col < col_start_ + ncols_) {

            int idx = (row - row_start_) * ncols_ + (col - col_start_);
            return tile_map_[idx];
        }
        else
            return -1;
    }

    // Returns true if this is a "priority tile".
    bool is_priority(int row, int col) const {
        if (row >= row_start_ && row < row_start_ + nrows_ &&
            col >= col_start_ && col < col_start_ + ncols_) {

            int idx = (row - row_start_) * ncols_ + (col - col_start_);
            return is_prio_[idx];
        }
        else
            return false;
    }

    // An iterator that combines iterators for all elements of `results`.
    class Iterator {
      private:
        int buf_id_;  // Can't use "const" because we need assignment.
        const IntersectionResultSet *parent_;
        size_t ir_idx_;
        typename IntersectionResult<DType>::Iterator iter_;

        friend class IntersectionResultSet;

        Iterator(int buf_id, const IntersectionResultSet *parent)
            : buf_id_(buf_id), parent_(parent), ir_idx_(0),
              iter_(nullptr, 0) /* will be filled by get_iter(). */
        { }

      public:
        bool has_next() const { return iter_.has_next(); }
        inline DType get_next();
        DType peek() const { return iter_.peek(); }
    };

    Iterator get_iter(int buf_id) const {
        Iterator iter(buf_id, this);

        for (size_t idx = 0; idx < results.size(); idx++) {
            auto iter2 = results[idx]->get_iter(buf_id);
            if (iter2.has_next()) {
                iter.ir_idx_ = idx;
                iter.iter_ = iter2;
                return iter;
            }
        }

        return iter;
    }
};

template<> inline int64_t IntersectionResultSet<int64_t>::Iterator::get_next()
{
    int64_t retval = iter_.get_next();
    if (!iter_.has_next()) {
        // Try the next iterator.
        for (ir_idx_++; ir_idx_ < parent_->results.size(); ir_idx_++) {
            iter_ = parent_->results[ir_idx_]->get_iter(buf_id_);
            if (iter_.has_next()) return retval;
        }
    }

    return retval;
}

} // namespace croquis
