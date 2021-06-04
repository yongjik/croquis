// A buffer for RGB image tile.

#pragma once

#include <stdint.h>  // uint32_t
#include <string.h>  // memset

#include <immintrin.h>  // __m128i

#include <memory>  // unique_ptr
#include <string>

#include "croquis/constants.h"  // TILE_SIZE
#include "croquis/message.h"  // UniqueMessageData
#include "croquis/util/macros.h"  // DIE_MSG

namespace croquis {

class GrayscaleBuffer;

// An abstract base class for RgbBuffer or RgbaBuffer.
class ColoredBufferBase {
  public:
    // Each BitmapBuffer contains 256x256 pixels, and each block is 4x4.
    enum { BLK_CNT = 4096 };  // = (256 * 256) / (4 * 4)
    static_assert(BLK_CNT == (TILE_SIZE * TILE_SIZE) / 16, "Sanity check");

    virtual ~ColoredBufferBase() { }

    // Merge the data from GrayscaleBuffer with the given color, and clears
    // GrayscaleBuffer.
    // `line_id` is used in RgbBuffer to update `hovermap` on affected pixels.
    virtual void merge(GrayscaleBuffer *buf, int line_id,
                       uint32_t color /* 0xaarrggbb */) = 0;

    // Create a buffer of pixels organized according to PNG spec: it can be
    // compressed (via zlib) to generate a PNG IDAT chunk.
    //
    // (For simplicity, we're going to use python's `zlib` module to handle
    // compression for us, for now.)
    virtual std::unique_ptr<UniqueMessageData>
    make_png_data(const std::string &name) const = 0;

    // Only available for RgbBuffer.
    virtual std::unique_ptr<UniqueMessageData>
    make_hovermap_data(const std::string &name) const = 0;

    // Helper function for debugging.
    virtual uint32_t get_pixel(int x, int y) const = 0;
};

// RgbBuffer internally contains two buffers:
// - `buf` contains RGB values in successive 4x4 blocks.
// - `hovermap` contains the ID of the last merge() operation that touched the
//   pixel: it is used by FE to figure out which "line" is currently under the
//   mouse cursor.
class RgbBuffer final : public ColoredBufferBase {
  public:
    // Comprised of 16-byte blocks, where each block is a 4x4 area.
    // Block #0: (0..3, 0..3), R
    // Block #1: (0..3, 0..3), G
    // Block #2: (0..3, 0..3), B
    // Block #3: (4..7, 0..3), R
    // ...
    alignas(16) __m128i buf[BLK_CNT * 3];

    // Comprised of 64-byte blocks, where each block is a 4x4 area of 32-bit
    // integers.  Initialized to -1.
    //
    // It seems like C++ doesn't correctly support 32-byte alignment until
    // C++17 - so let's use posix_memalign for now, so that we can compile on
    // C++14.
    __m256i *hovermap;  // alignas(32) __m256i hovermap[BLK_CNT * 2];

    RgbBuffer(uint32_t color);  // color = 0x??rrggbb
    ~RgbBuffer();

    void merge(GrayscaleBuffer *buf, int line_id,
               uint32_t color /* 0xaarrggbb */) override;

    std::unique_ptr<UniqueMessageData>
    make_png_data(const std::string &name) const override;

    // Create a buffer of hovermap data arranged in the ordinary pixel order.
    std::unique_ptr<UniqueMessageData>
    make_hovermap_data(const std::string &name) const override;

    uint32_t get_pixel(int x, int y) const override {
        int idx1 = (y / 4) * 64 + (x / 4);
        int idx2 = (y % 4) * 4 + (x % 4);

        uint8_t r = ((const char *) buf)[idx1 * 48 + idx2];
        uint8_t g = ((const char *) buf)[idx1 * 48 + 16 + idx2];
        uint8_t b = ((const char *) buf)[idx1 * 48 + 32 + idx2];
        return ((uint32_t) r << 16) + ((uint32_t) g << 8) + b;
    }
};

// For highlight tiles: similar as above, but also contains the alpha channel,
// and does not contain the hovermap.
//
// The formula for correctly combining RGBA channels is rather complicated [1].
// To simplify computation, and because I'm lazy, we store intermediate data in
// a non-transparent "4-color" format: let's call it RGBW.
//
//  - At start, everything is black.
//
//  - At each merge(), RGB colors are added to the black background just like
//    RgbBuffer.  A pseudo-color, "white", is added as if it is always 255.
//    I.e., if the given color is (r, g, b), then we treat it as (R=r, G=g, B=b,
//    W=255).
//
//  - At the end, (r, g, b, w) can be converted to RGBA as:
//      R = r * (255 / w)
//      G = g * (255 / w)
//      B = b * (255 / w)
//      A = w
//
//    (This does not overflow because the construction guarantees r<=w, etc.)
//
// This obviously loses some information: e.g., if w=3, then r can be only
// between [0, 3], so the final red color has only two bits of depth.  On the
// other hand, who really cares about fidelity of red when alpha channel is 3.
//
// [1] See: https://en.wikipedia.org/wiki/Alpha_compositing
//
// TODO: Refactor?
class RgbaBuffer final : public ColoredBufferBase {
  public:
    // Comprised of 16-byte blocks, where each block is a 4x4 area.
    //
    // Block #0: (0..3, 0..3), R
    // Block #1: (0..3, 0..3), G
    // Block #2: (0..3, 0..3), B
    // Block #3: (0..3, 0..3), W
    // Block #4: (4..7, 0..3), R
    // ...
    alignas(16) __m128i buf[BLK_CNT * 4];

    RgbaBuffer() { memset(buf, 0x00, sizeof(buf)); }

    // `line_id` is unused here.
    void merge(GrayscaleBuffer *buf, int line_id,
               uint32_t color /* 0xaarrggbb */) override;

    std::unique_ptr<UniqueMessageData>
    make_png_data(const std::string &name) const override;

    std::unique_ptr<UniqueMessageData>
    make_hovermap_data(const std::string &name) const override {
        DIE_MSG("RgbaBuffer doesn't support make_hovermap_data()!\n");
    }

    uint32_t get_pixel(int x, int y) const override {
        int idx1 = (y / 4) * 64 + (x / 4);
        int idx2 = (y % 4) * 4 + (x % 4);

        uint8_t r = ((const char *) buf)[idx1 * 64 + idx2];
        uint8_t g = ((const char *) buf)[idx1 * 64 + 16 + idx2];
        uint8_t b = ((const char *) buf)[idx1 * 64 + 32 + idx2];
        uint8_t w = ((const char *) buf)[idx1 * 64 + 48 + idx2];
        return ((uint32_t) w << 24) +
               ((uint32_t) r << 16) + ((uint32_t) g << 8) + b;
    }
};

} // namespace croquis
