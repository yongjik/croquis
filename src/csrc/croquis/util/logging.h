// Logging support.

#pragma once

#include <stdarg.h>  // va_list

#include <string>

#include "croquis/util/string_printf.h"

namespace croquis {
namespace util {

// Set up the logging so that it matches Python code.
void init_logging(double start_time, int log_fd);

// Set up the current thread's name for logging.
void set_thread_name(const std::string &name);

void log(const char *file, int line, const std::string &s);

#define DBG_LOG(enabled, msg) \
    do  { \
        if (enabled) ::croquis::util::log(__FILE__, __LINE__, msg); \
    } while (0)

#define DBG_LOG1(enabled, ...) \
    do  { \
        if (enabled) \
            ::croquis::util::log(__FILE__, __LINE__, \
                                 ::croquis::util::string_printf(__VA_ARGS__)); \
    } while (0)

}  // namespace util
}  // namespace croquis
