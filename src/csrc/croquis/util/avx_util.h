// Utility functions to be used with AVX intrinsics.

#include <string.h>  // memcpy

#include <immintrin.h>

#include <string>

#include "croquis/util/string_printf.h"

namespace croquis {
namespace util {

static inline std::string to_string(__m256i a)
{
    int d[8];
    memcpy((void *) d, (void *) &a, 32);
    return string_printf("%08x_%08x_%08x_%08x_%08x_%08x_%08x_%08x",
                         d[7], d[6], d[5], d[4], d[3], d[2], d[1], d[0]);
}

}  // namespace util
}  // namespace croquis
