// Logging support.

#include "croquis/util/logging.h"

#include <math.h>  // floor
#include <string.h>  // strrchr
#include <time.h>  // clock_gettime, strftime
#include <unistd.h>  // write

#include <string>
#include <vector>

#include "croquis/util/string_printf.h"

namespace croquis {
namespace util {

static double start_time_;
static int log_fd_ = -1;

static thread_local const char *thr_name_ = "";

// Keep thread names here: never freed.
static std::vector<std::string *> thr_names_;

void init_logging(double start_time, int log_fd)
{
    start_time_ = start_time;
    log_fd_ = log_fd;
}

void set_thread_name(const std::string &name)
{
    std::string *s = new std::string(name);
    thr_names_.push_back(s);
    thr_name_ = s->c_str();
}

void log(const char *file, int line, const std::string &s)
{
    // Remove directory from `file`.
    const char *p = strrchr(file, '/');
    if (p != nullptr) file = p + 1;

    // Find the current time (HH:MM:SS).
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    time_t tv_sec = ts.tv_sec;
    struct tm tm;
    localtime_r(&tv_sec, &tm);

    char time_str[20];
    strftime(time_str, 20, "%H:%M:%S", &tm);

    double T = (double) ts.tv_sec + (ts.tv_nsec / 1e9);
    double relative = T - start_time_;
    double usec = ((relative * 0.01) - floor(relative * 0.01)) * 100;

    // TODO: Python version also shows "elapsed_str", that is, time elapsed
    //       since the last log by this thread.

    std::string log_line = util::string_printf(
        ">%s.%06d %-15s %9.6f %s:%d ",
        time_str, (int) (ts.tv_nsec / 1000), thr_name_, usec, file, line);
    log_line += s;
    if (log_line.back() != '\n') log_line += '\n';

    // TODO: Support level, and write important messages to stderr!
    // write(2, log_line.c_str(), log_line.size());

    if (log_fd_ != -1)
        write(log_fd_, log_line.c_str(), log_line.size());
}

}  // namespace util
}  // namespace croquis

