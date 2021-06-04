// Mathematical utility functions.
// TODO: Vectorize?

#pragma once

#include <math.h>  // isnan

#include <utility>  // pair

namespace croquis {
namespace util {

// Utility function to decide the initial coordinate range.
template<typename T>
static inline std::pair<T, T> initial_range(T m, T M)
{
    T diff = M - m;
    T margin = (diff == 0.0) ? 1.0 : diff * 0.05;
    return std::make_pair(m - margin, M + margin);
}

#if 0
float min(const float *data, size_t sz) {
    float m = data[0];

    for (const float *p = data; p < data + sz; p++) {
        m = std::min(m, *p);
    }

    return m;
}
#endif

// Find min/max values among non-NaN values.
// If `data` is all NaN, just return some NaN value.
static inline std::pair<float, float> minmax(const float *data, size_t sz)
{
    const float *ptr = data;
    const float *end = data + sz;

    float m, M;
    while (ptr < end) {
        m = M = *(ptr++);
        if (!isnan(m)) break;
    }

    while (ptr < end) {
        float v = *(ptr++);
        if (v < m) m = v;
        if (v > M) M = v;
        ptr++;
    }

    return std::make_pair(m, M);
}

}  // namespace util
}  // namespace croquis
