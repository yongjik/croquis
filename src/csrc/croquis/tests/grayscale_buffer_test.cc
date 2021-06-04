// Test GrayscaleBuffer.
//
// TODO: Use a proper test framework!

#include "croquis/grayscale_buffer.h"

#include <assert.h>
#include <math.h>  // sqrtf
#include <stdio.h>  // fopen
#include <stdint.h>  // uint64_t
#include <string.h>  // memcpy

#include <immintrin.h>  // _mm_testz_si128

#include <algorithm>  // max
#include <random>
#include <unordered_set>

#include "croquis/util/string_printf.h"

namespace croquis {

// Helper function for examining the contents of the buffer.
static void write_bitmap(const GrayscaleBuffer &buf, const char *filename)
{
    FILE *fp = fopen(filename, "wb");
    for (int y = 0; y < 256; y++) {
        for (int x = 0; x < 256; x++) {
            uint8_t pixel = buf.get_pixel(x, y);
            fwrite(&pixel, 1, 1, fp);
        }
    }
    fclose(fp);
}

static void do_test(GrayscaleBuffer *buf,
                    float x0, float y0, float x1, float y1, float width)
{
#if 0
    printf("!!! x0 y0 x1 y1 w = %.3f %.3f %.3f %.3f %.3f\n",
           x0, y0, x1, y1, width);
#endif

    GrayscaleBuffer before;
    memcpy(before.buf, buf->buf, sizeof(buf->buf));

    buf->draw_line(x0, y0, x1, y1, width);

    bool xyflip = (fabsf(y1 - y0) > fabsf(x1 - x0));
    if (xyflip) {
        float tmp;
        tmp = x0; x0 = y0; y0 = tmp;
        tmp = x1; x1 = y1; y1 = tmp;
    }

    if (x1 < x0) {
        float tmp;
        tmp = x0; x0 = x1; x1 = tmp;
        tmp = y0; y0 = y1; y1 = tmp;
    }

    // Now check if the line was drawn correctly.
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const float len = sqrtf(dx * dx + dy * dy);
    const float wx = dy * (width / (2 * len));
    const float wy = dx * (width / (2 * len));

    // Guard against random numerical inconsistency.
    const float EPSILON = 0.001;

    const int xmin0 = nearbyintf(fminf(x0, x1) - fabsf(wx) - EPSILON);
    const int xmax0 = nearbyintf(fmaxf(x0, x1) + fabsf(wx) - EPSILON);
    const int ymin0 = nearbyintf(fminf(y0, y1) - fabsf(wy) - EPSILON);
    const int ymax0 = nearbyintf(fmaxf(y0, y1) + fabsf(wy) - EPSILON);

    const int xmin1 = nearbyintf(fminf(x0, x1) - fabsf(wx) + EPSILON);
    const int xmax1 = nearbyintf(fmaxf(x0, x1) + fabsf(wx) + EPSILON);
    const int ymin1 = nearbyintf(fminf(y0, y1) - fabsf(wy) + EPSILON);
    const int ymax1 = nearbyintf(fmaxf(y0, y1) + fabsf(wy) + EPSILON);

    const float slope = dy / dx;

#if 0
    printf("    %sx0 y0 x1 y1 w = %.3f %.3f %.3f %.3f %.3f\n",
           (xyflip) ? "(xy flipped) " : "",
           x0, y0, x1, y1, width);
    printf("    dx dy len wx wy = %.3f %.3f %.3f %.4f %.4f\n",
           dx, dy, len, wx, wy);
    printf("    xmin xmax ymin ymax = %d(%d) %d(%d) %d(%d) %d(%d)\n",
           xmin0, xmin1, xmax0, xmax1, ymin0, ymin1, ymax0, ymax1);
#endif

    for (int y = 0; y < 256; y++) {
        for (int x = 0; x < 256; x++) {
            uint8_t orig, pixel;
            if (xyflip) {
                orig = before.get_pixel(y, x);
                pixel = buf->get_pixel(y, x);
            }
            else {
                orig = before.get_pixel(x, y);
                pixel = buf->get_pixel(x, y);
            }

            float yL = slope * (x - (x0 + wx)) + (y0 - wy);
            float yH = slope * (x - (x0 - wx)) + (y0 + wy);

            // allowed0/allowed1: slightly smaller/larger bounding box.
            bool allowed0 =
                (xmin1 <= x) && (x <= xmax0) && (ymin1 <= y) && (y <= ymax0);
            bool allowed1 =
                (xmin0 <= x) && (x <= xmax1) && (ymin0 <= y) && (y <= ymax1);

            float frac = fminf(y + 0.5f - yL, 1.0f);
            if (yH < y + 0.5f) frac -= y + 0.5f - yH;
            frac = fmaxf(frac, 0.0f);

            uint8_t color0 = nearbyintf(frac * 255.f) * allowed0;
            uint8_t expected0 = std::max(orig, color0);
            uint8_t color1 = nearbyintf(frac * 255.f) * allowed1;
            uint8_t expected1 = std::max(orig, color1);

            // TODO: We need some macro for testing!
            int threshold = 1 + (int) (width / 40);
            // assert(abs(expected - pixel) <= threshold);
            if (abs(expected0 - pixel) > threshold &&
                abs(expected1 - pixel) > threshold) {
                printf("(%d, %d) orig=%d expected color=%d(%d) actual=%d: "
                       "yL=%.3f yH=%.3f\n",
                       x, y, orig, color0, color1, pixel, yL, yH);
            }
        }
    }

    // Check that blklist is correct.
    std::unordered_set<int> blks;
    for (int i = 0; i < buf->blk_cnt; i++) {
        int blk_id = buf->blklist[i];
        // printf("Found blk #%d\n", blk_id);
        if (blks.count(blk_id)) printf("blk #%d duplicate!\n", blk_id);
        assert(blks.count(blk_id) == 0);
        blks.insert(blk_id);
    }

    for (int blk_id = 0; blk_id < GrayscaleBuffer::BLK_CNT; blk_id++) {
        __m128i blk = buf->buf[blk_id];
        bool is_zero = _mm_testz_si128(blk, blk);
        assert(blks.count(blk_id) == !is_zero);
    }
}

static void test_lines()
{
    GrayscaleBuffer buf;

    do_test(&buf, -20.0, 10.0, 250.0, 150.0, 4.5);
    do_test(&buf, 20.0, 10.0, 250.0, 220.0, 3.0);
    do_test(&buf, 50.0, 125.0, 500.0, 200.0, 15.0);

    // Test flat line.
    do_test(&buf, 40.0, 150.0, 300.0, 150.0, 8.1);
    do_test(&buf, 30.0, 200.0, 300.0, 202.5, 2.5);

    // Some random lines from previous tests.
    do_test(&buf, -63.78, 289.14, 225.55, 131.13, 3.29);
    do_test(&buf, -170.27, 185.94, 249.37, 93.87, 38.43);
    do_test(&buf, 278.843, -1.208, -205.838, 307.298, 1.794);
    do_test(&buf, 484.980, 276.463, 23.283, 113.903, 2.975);

    write_bitmap(buf, "test1.dat");
}

static void test_random_lines()
{
    std::mt19937 gen(12345678);  // Random number generator.
    std::normal_distribution<float> coord_dist(128.0, 200.0);
    std::uniform_real_distribution<float> width_dist(0.0, 5.0);

    for (int n = 0; n < 20; n++) {
        printf("Running random test iteration #%d ...\n", n);
        GrayscaleBuffer buf;

        for (int i = 0; i < 200; i++) {
            float x0 = coord_dist(gen);
            float y0 = coord_dist(gen);
            float x1 = coord_dist(gen);
            float y1 = coord_dist(gen);

            // Skew toward reasonable (<5) width, but leave a few large values
            // for testing edge cases.
            float width = width_dist(gen);
            if (width_dist(gen) < 0.1)
                width *= 10;
            if (width_dist(gen) < 0.001 * n)
                width *= 100;

            // printf("%.3f %.3f %.3f %.3f %.3f\n", x0, y0, x1, y1, width);
            do_test(&buf, x0, y0, x1, y1, width);
        }

        write_bitmap(buf, util::string_printf("random-%d.dat", n).c_str());
    }
}

static void run_test()
{
    test_lines();
    test_random_lines();
}

} // namespace croquis

int main()
{
    croquis::run_test();
    return 0;
}
