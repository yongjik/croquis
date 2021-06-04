// Helper for creating Python exceptions.

#pragma once

namespace croquis {
namespace util {

[[noreturn]] void throw_value_error(const char *fmt, ...)
    __attribute__((format(printf, 1, 2)));

}  // namespace util
}  // namespace croquis
