// Line algorithm test.

#include "croquis/line_algorithm.h"

#include <assert.h>
#include <stdio.h>

#include <memory>  // make_unique
#include <random>

namespace croquis {

class LineAlgorithmTester {
  private:
    int xmin_, ymin_, xmax_, ymax_;

  public:
    LineAlgorithmTester(int xmin, int ymin, int xmax, int ymax)
        : xmin_(xmin), ymin_(ymin), xmax_(xmax), ymax_(ymax) { }

    void do_test(float x0, float y0, float x1, float y1, float width);
};

void LineAlgorithmTester::do_test(float x0, float y0, float x1, float y1,
                                  float width)
{
#if 0
    printf("!!! x0 y0 x1 y1 w = %.3f %.3f %.3f %.3f %.3f\n",
           x0, y0, x1, y1, width);
#endif

    const int nrows = ymax_ - ymin_ + 1;
    const int ncols = xmax_ - xmin_ + 1;
    auto pixels = std::make_unique<bool[]>(nrows * ncols);
    for (int i = 0; i < nrows * ncols; i++) pixels[i] = false;

    auto visitor = create_straight_line_visitor(
        xmin_, ymin_, xmax_, ymax_,
        [&](int x, int y) {
            int idx = (y - ymin_) * ncols + (x - xmin_);
            // printf("Visiting %d %d (= #%d)...\n", x, y, idx);
            pixels[idx] = true;
        }
    );

    visitor.visit(x0, y0, x1, y1, width);

    // TODO: The following code is mostly duplicated in
    //       grayscale_buffer_test.cc.
    bool xyflip = (fabsf(y1 - y0) > fabsf(x1 - x0));
    float u0 = (xyflip) ? y0 : x0;
    float v0 = (xyflip) ? x0 : y0;
    float u1 = (xyflip) ? y1 : x1;
    float v1 = (xyflip) ? x1 : y1;

    if (u1 < u0) {
        float tmp;
        tmp = u0; u0 = u1; u1 = tmp;
        tmp = v0; v0 = v1; v1 = tmp;
    }

    // Now check if the line was drawn correctly.
    const float du = u1 - u0;
    const float dv = v1 - v0;
    const float len = sqrtf(du * du + dv * dv);
    const float wu = dv * (width / (2 * len));
    const float wv = du * (width / (2 * len));

    // Guard against random numerical inconsistency.
    const float EPSILON = 0.001;

    const float umin = u0 - fabsf(wu);
    const float umax = u1 + fabsf(wu);
    const float vmin = fminf(v0, v1) - fabsf(wv);
    const float vmax = fmaxf(v0, v1) + fabsf(wv);

    const float slope = dv / du;

#if 0
    printf("    %sx0 y0 x1 y1 w = %.3f %.3f %.3f %.3f %.3f\n",
           (xyflip) ? "(xy flipped) " : "",
           x0, y0, x1, y1, width);
    printf("    dx dy len wx wy = %.3f %.3f %.3f %.4f %.4f\n",
           dx, dy, len, wx, wy);
    printf("    xmin xmax ymin ymax = %d(%d) %d(%d) %d(%d) %d(%d)\n",
           xmin0, xmin1, xmax0, xmax1, ymin0, ymin1, ymax0, ymax1);
#endif

    for (int y = ymin_; y <= ymax_; y++) {
        for (int x = xmin_; x <= xmax_; x++) {
            bool expected0, expected1;
            bool visited = pixels[(y - ymin_) * ncols + (x - xmin_)];

            // expected0/expected1: using a slightly tight/lenient criterion to
            // guard against numerical errors.
            if (xyflip) {
                float xL, xH;
                if (slope > 0.0) {
                    xL = slope * (y - 0.5f - (u0 + wu)) + (v0 - wv);
                    xH = slope * (y + 0.5f - (u0 - wu)) + (v0 + wv);
                }
                else {
                    xL = slope * (y + 0.5f - (u0 + wu)) + (v0 - wv);
                    xH = slope * (y - 0.5f - (u0 - wu)) + (v0 + wv);
                }

                expected0 = (x >= nearbyintf(xL + EPSILON)) &&
                            (x <= nearbyintf(xH - EPSILON)) &&
                            (vmin < x + 0.5f - EPSILON) &&
                            (vmax > x - 0.5f + EPSILON) &&
                            (umin < y + 0.5f - EPSILON) &&
                            (umax > y - 0.5f + EPSILON);
                expected1 = (x >= nearbyintf(xL - EPSILON)) &&
                            (x <= nearbyintf(xH + EPSILON)) &&
                            (vmin < x + 0.5f + EPSILON) &&
                            (vmax > x - 0.5f - EPSILON) &&
                            (umin < y + 0.5f + EPSILON) &&
                            (umax > y - 0.5f - EPSILON);
            }
            else {
                float yL, yH;
                if (slope > 0.0) {
                    yL = slope * (x - 0.5f - (u0 + wu)) + (v0 - wv);
                    yH = slope * (x + 0.5f - (u0 - wu)) + (v0 + wv);
                }
                else {
                    yL = slope * (x + 0.5f - (u0 + wu)) + (v0 - wv);
                    yH = slope * (x - 0.5f - (u0 - wu)) + (v0 + wv);
                }

                expected0 = (y >= nearbyintf(yL + EPSILON)) &&
                            (y <= nearbyintf(yH - EPSILON)) &&
                            (umin < x + 0.5f - EPSILON) &&
                            (umax > x - 0.5f + EPSILON) &&
                            (vmin < y + 0.5f - EPSILON) &&
                            (vmax > y - 0.5f + EPSILON);
                expected1 = (y >= nearbyintf(yL - EPSILON)) &&
                            (y <= nearbyintf(yH + EPSILON)) &&
                            (umin < x + 0.5f + EPSILON) &&
                            (umax > x - 0.5f - EPSILON) &&
                            (vmin < y + 0.5f + EPSILON) &&
                            (vmax > y - 0.5f - EPSILON);
            }

#if 0
            if (expected0 || expected1) {
                printf("x=%d y=%d expected=%d %d visited=%d\n",
                       x, y, expected0, expected1, visited);
            }
#endif

            if (expected0) {
                assert(expected1);
                assert(visited);
            }
            else if (!expected1) {
                assert(!visited);
            }
        }
    }
}

static void test_lines()
{
    {
        LineAlgorithmTester tester(-10, -10, 30, 20);
        tester.do_test(1.48, 1.65, 1.52, 1.65, 0.01);
    }

    {
        LineAlgorithmTester tester(-10, -10, 300, 200);

        tester.do_test(-20.0, 10.0, 250.0, 150.0, 4.5);
        tester.do_test(20.0, 10.0, 250.0, 220.0, 3.0);
        tester.do_test(50.0, 125.0, 500.0, 200.0, 15.0);

        // Copied from grayscale_buffer_test.cc.
        tester.do_test(-63.78, 289.14, 225.55, 131.13, 3.29);
        tester.do_test(-170.27, 185.94, 249.37, 93.87, 38.43);
        tester.do_test(278.843, -1.208, -205.838, 307.298, 1.794);
        tester.do_test(484.980, 276.463, 23.283, 113.903, 2.975);
    }
}

static void test_random_lines()
{
    std::mt19937 gen(12345678);  // Random number generator.
    std::normal_distribution<float> coord_dist(0.0, 150.0);
    std::uniform_real_distribution<float> width_dist(0.0, 0.1);

    for (int n = 0; n < 20; n++) {
        printf("Running random test iteration #%d ...\n", n);
        LineAlgorithmTester tester(-150, -100, 200, 120);

        for (int i = 0; i < 200; i++) {
            float x0 = coord_dist(gen);
            float y0 = coord_dist(gen);
            float x1 = coord_dist(gen);
            float y1 = coord_dist(gen);
            float width = width_dist(gen);

            // printf("%.3f %.3f %.3f %.3f %.3f\n", x0, y0, x1, y1, width);
            tester.do_test(x0, y0, x1, y1, width);
        }
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
