// Helper for creating Python exceptions.

#include "croquis/util/error_helper.h"

#include <stdarg.h>  // va_start

#include <pybind11/pybind11.h>

#include "croquis/util/string_printf.h"

namespace croquis {
namespace util {

namespace py = pybind11;

[[noreturn]] void throw_value_error(const char *fmt, ...)
{
    va_list va;
    va_start(va, fmt);
    std::string msg = string_vprintf(fmt, va);
    va_end(va);

    throw py::value_error(msg);
}

}  // namespace util
}  // namespace croquis
