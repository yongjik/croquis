// Test BitmapBuffer.
//
// TODO: Use a proper test framework!

#include "croquis/bitmap_buffer.h"

#include <assert.h>
#include <math.h>  // sqrtf
#include <stdio.h>  // fopen
#include <stdint.h>  // uint64_t
#include <string.h>  // memcpy

#include <unordered_set>

namespace croquis {

// Helper function for examining the contents of the buffer.
static void write_bitmap(const BitmapBuffer &buf, const char *filename)
{
    FILE *fp = fopen(filename, "wb");
    for (int y = 0; y < 512; y++) {
        for (int x = 0; x < 512; x++) {
            uint8_t pixel = buf.get_pixel(x, y) ? 255 : 0;
            fwrite(&pixel, 1, 1, fp);
        }
    }
    fclose(fp);
}

static void do_test(BitmapBuffer *buf,
                    float x0, float y0, float x1, float y1, float width)
{
    BitmapBuffer before;
    memcpy(before.buf, buf->buf, sizeof(buf->buf));

    buf->draw_line(x0, y0, x1, y1, width);

    // Now check if the line was drawn correctly.
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const float len = sqrtf(dx * dx + dy * dy);
    const float wx = dy * (width / (2 * len));
    const float wy = dx * (width / (2 * len));

    const int xmin = nearbyintf(x0 - wx);
    const int xmax = nearbyintf(x1 + wx);
    const int ymin = nearbyintf(y0 - wy);
    const int ymax = nearbyintf(y1 + wy);

    const float slope = dy / dx;

    for (int y = 0; y < 512; y++) {
        for (int x = 0; x < 512; x++) {
            bool orig = before.get_pixel(x, y);
            bool pixel = buf->get_pixel(x, y);

            float yL = slope * (x - (x0 + wx)) + (y0 - wy);
            float yH = slope * (x - (x0 - wx)) + (y0 + wy);
            bool is_line = (xmin <= x) && (x <= xmax) &&
                           (ymin <= y) && (y <= ymax) &&
                           (y >= yL) && (y <= yH);

            // TODO: We need some macro for testing!
            if (is_line) {
                assert(pixel);
                if (!pixel) {
                    printf("missing pixel: x=%d y=%d yL=%.4f yH=%.4f\n",
                           x, y, yL, yH);
                }
            }
            else {
                assert(orig == pixel);
                if (orig != pixel) {
                    printf("should be same but orig %d pixel %d: x=%d y=%d\n",
                           orig, pixel, x, y);
                }
            }
        }
    }

    // Check that blklist is correct.
    std::unordered_set<int> blks;
    for (int i = 0; i < buf->blk_cnt; i++) {
        int blk_id = buf->blklist[i];
        assert(blks.count(blk_id) == 0);
        blks.insert(blk_id);
    }

    for (int blk_id = 0; blk_id < BitmapBuffer::BLK_CNT; blk_id++)
        assert(blks.count(blk_id) == (buf->buf[blk_id] != 0ULL));
}

static void run_test()
{
    BitmapBuffer buf;

    do_test(&buf, -20.0, 10.0, 300.0, 150.0, 4.5);
    do_test(&buf, 20.0, 10.0, 300.0, 250.0, 3.0);
    do_test(&buf, 50.0, 125.0, 700.0, 300.0, 15.0);

    // Test flat line.
    do_test(&buf, 40.0, 350.0, 600.0, 350.0, 8.1);
    do_test(&buf, 30.0, 450.0, 600.0, 451.7, 2.5);

    write_bitmap(buf, "test1.dat");
}

} // namespace croquis

int main()
{
    croquis::run_test();
    return 0;
}
