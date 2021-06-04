#include "croquis/util/string_printf.h"

#include <stdarg.h>  // va_start
#include <stdio.h>   // sprintf

using std::string;

namespace croquis {
namespace util {

string string_printf(const char *fmt, ...)
{
    std::string retval;

    va_list va;
    va_start(va, fmt);
    retval = string_vprintf(fmt, va);
    va_end(va);

    return retval;
}

string string_vprintf(const char *fmt, va_list ap)
{
    va_list ap2;
    va_copy(ap2, ap);

    size_t sz = 64;
    std::string buf(sz, ' ');

    int new_sz = vsnprintf(&(buf[0]), sz, fmt, ap);

    // Need one more byte because vsnprintf always emits the final '\0'.
    buf.resize(new_sz + 1, ' ');
    if (new_sz >= sz) {
        vsnprintf(&(buf[0]), new_sz + 1, fmt, ap2);
        va_end(ap2);
    }
    buf.resize(new_sz, ' ');

    return buf;
}

}  // namespace util
}  // namespace croquis
