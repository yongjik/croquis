// Utility function for getting a monotonic clock.

#pragma once

#include <stdint.h>  // int64_t
#include <time.h>  // clock_gettime

namespace croquis {
namespace util {

// Return a monotonic timestamp in microsecond resolution.
//
// Not sure exactly how it is computed, but assuming it starts at zero at boot,
// we can run for ~292k years before overflow, so I think we're good.
//
// TODO: What about Windows?
inline int64_t microtime()
{
    struct timespec ts;

    // Let's ignore rc: hopefully it shouldn't fail ...
    int rc = clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((int64_t) (ts.tv_sec) * 1000000) + (int64_t) (ts.tv_nsec / 1000);
}

}  // namespace util
}  // namespace croquis
