// String utility functions.

#pragma once

#include <stdarg.h>  // va_list

#include <string>

namespace croquis {
namespace util {

std::string string_printf(const char *fmt, ...)
    __attribute__((format(printf, 1, 2)));

std::string string_vprintf(const char *fmt, va_list ap);

// Utility function for converting a double exactly.
// According to Wikipedia, 17 digits should be enough.
inline std::string double_to_string(double d)
{ return string_printf("%.17g", d); }

}  // namespace util
}  // namespace croquis
