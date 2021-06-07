// Apparently clang++ in Mac OS does not support std::experimental::optional,
// even when I invoke it with -std=c++14 !!
// So, I've decided to just use C++17 - see CMakeLists.txt for discussion.
//
// On the other hand, in Linux we only have std::experimental::optional if I use
// -std=c++14.

#if defined(USE_EXPERIMENTAL_OPTIONAL)

#include <experimental/optional>

namespace croquis {
template<class T> using optional = std::experimental::optional<T>;
}  // namespace croquis

#elif defined(USE_STD_OPTIONAL)

#include <optional>

namespace croquis {
template<class T> using optional = std::optional<T>;
}  // namespace croquis

#else

#error "Expecting either USE_EXPERIMENTAL_OPTIONAL or USE_STD_OPTIONAL !!"

#endif
