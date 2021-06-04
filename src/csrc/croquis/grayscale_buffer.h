// A buffer in 256-color grayscle for drawing lines fast (hopefully).

#pragma once

#include <stdint.h>  // uint64_t
#include <string.h>  // memset

#include <immintrin.h>  // __m128i

namespace croquis {

class GrayscaleBuffer {
  public:
    // Each BitmapBuffer contains 256x256 pixels, and each block is 4x4.
    enum { BLK_CNT = 4096 };  // = (256 * 256) / (4 * 4)

    // Comprised of 16-byte blocks, where each block is a 4x4 area.
    alignas(16) __m128i buf[BLK_CNT];

    // List of blocks that are changed so far: we have 2 extra entries, because
    // store_blks() may write up to 2 entries past the end.
    uint16_t blklist[BLK_CNT + 2];
    int blk_cnt = 0;  // Number of blocks stored in `blklist`.

    GrayscaleBuffer() { memset(buf, 0x00, BLK_CNT * sizeof(__m128i)); }

    void reset() {
        for (int i = 0; i < blk_cnt; i++)
            _mm_store_si128(&buf[blklist[i]], _mm_setzero_si128());
        blk_cnt = 0;
    }

  private:
    // Helper function.
    inline void store_blk(int offset, __m128i blks);

  public:
    void draw_line(float x0, float y0, float x1, float y1, float width);
    void draw_circle(float x0, float y0, float radius);

    // Helper function to get a pixel for testing.
    inline uint8_t get_pixel(int x, int y) const {
        int idx1 = (y / 4) * 64 + (x / 4);
        int idx2 = (y % 4) * 4 + (x % 4);

        // I think this *should* be `char` to work around the "strict aliasing"
        // rule.
        return ((const char *) buf)[idx1 * 16 + idx2];
    }
};

} // namespace croquis
