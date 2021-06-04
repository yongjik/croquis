// Bitmap buffer for drawing lines with AVX intrinsics.

#pragma once

#include <stdint.h>  // uint64_t
#include <string.h>  // memset

#include <immintrin.h>  // __m256i

namespace croquis {

class BitmapBuffer {
  public:
    // Each BitmapBuffer contains 512x512 pixels, and each block is 8x8.
    enum { BLK_CNT = 4096 };  // = (512 * 512) / (8 * 8)

    // Comprised of 64bit blocks, where each block is an 8x8 area.
    alignas(32) uint64_t buf[BLK_CNT];

    // List of blocks that are changed so far: we have 4 extra entries, because
    // store_blks() may write up to 4 entries past the end.
    uint16_t blklist[BLK_CNT + 4];
    int blk_cnt = 0;  // Number of blocks stored in `blklist`.

    BitmapBuffer() { memset(buf, 0x00, BLK_CNT * sizeof(uint64_t)); }

    void reset() {
        for (int i = 0; i < blk_cnt; i++) buf[blklist[i]] = 0;
        blk_cnt = 0;
    }

  private:
    // Helper function.
    inline void store_blks(uint16_t offset, __m256i blks);

  public:
    void draw_line(float x0, float y0, float x1, float y1, float width);

    // Helper function to get a pixel for testing.
    inline bool get_pixel(int x, int y) const {
        int idx1 = (y / 8) * 64 + (x / 8);
        int idx2 = (y % 8) * 8 + (x % 8);
        uint64_t blk = buf[idx1];
        return (bool) ((blk >> idx2) & 0x01);
    }
};

} // namespace croquis
