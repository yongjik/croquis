// Miscellaneous helper functions for RGB handling.

#pragma once

#include <math.h>  // fmaxf
#include <stdint.h>  // uint32_t

namespace croquis {
namespace util {

// Convert floating-point RGB values to a 3-byte value.
static inline uint32_t get_rgb(float r, float g, float b)
{
    int r1 = nearbyintf(fmaxf(0.0f, fminf(r, 1.0f)) * 255.0);
    int g1 = nearbyintf(fmaxf(0.0f, fminf(g, 1.0f)) * 255.0);
    int b1 = nearbyintf(fmaxf(0.0f, fminf(b, 1.0f)) * 255.0);

    return (r1 << 16) + (g1 << 8) + b1;
}

static inline uint32_t get_argb(float r, float g, float b)
{
    return 0xff000000 + get_rgb(r, g, b);
}

}  // namespace util
}  // namespace croquis
