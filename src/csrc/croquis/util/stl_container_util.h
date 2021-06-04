// STL container helper functions.

#pragma once

#include <string>
#include <tuple>      // forward_as_tuple
#include <utility>    // move, piecewise_construct

namespace croquis {
namespace util {

template<class T>
inline void insert_if_nonexistent(T *container,
                                  const typename T::key_type &key,
                                  const typename T::mapped_type &value)
{
    if (container->count(key) == 0) {
        container->insert(make_pair(key, value));
    }
}

// Run push_back and return the reference to the added item.
template<class Container, class T>
inline typename Container::value_type &push_back(Container &v, T elem)
{
    v.push_back(std::forward<T>(elem));
    return v.back();
}

// Run emplace_back and return the reference to the emplaced item.
template<class Container, class... Args>
inline typename Container::value_type &emplace_back(Container &v, Args&&... args)
{
    v.emplace_back(std::forward<Args>(args)...);
    return v.back();
}

// Run make_unique + emplace_back and return the reference to the unique_ptr.
template<class Container, class... Args>
inline typename Container::value_type &
emplace_back_unique(Container &v, Args&&... args)
{
    v.emplace_back(std::make_unique<typename Container::value_type::element_type>
        (std::forward<Args>(args)...));
    return v.back();
}

// Run emplace and return the reference to the emplaced item.
// (If the key already exists, return the existing element.)
//
// TODO: I added "std::move" below so that it can correctly(???) forward rvalue
// references, but I have no idea how this works.  It may break some day... :/
template<class Container, class... Args>
inline typename Container::mapped_type &get_or_emplace(
    Container &v,
    const typename Container::key_type &key,
    Args&&... args)
{
    // I guess there was some *very* good reason, but seriously...
    // WTF C++11, who thought this is an acceptable syntax?
    std::pair<typename Container::iterator, bool> ret =
        v.emplace(std::piecewise_construct,
                  std::forward_as_tuple(key),
                  std::forward_as_tuple(std::move(args)...));
    return ret.first->second;
}

// Sometimes we do want to move the key.
template<class Container, class... Args>
inline typename Container::mapped_type &get_or_emplace(
    Container &v,
    typename Container::key_type &&key,
    Args&&... args)
{
    std::pair<typename Container::iterator, bool> ret =
        v.emplace(std::piecewise_construct,
                  std::forward_as_tuple(std::move(key)),
                  std::forward_as_tuple(std::move(args)...));
    return ret.first->second;
}

// Convenience function to construct strings with a delimiter.
template<typename T1, typename T2>
static inline void append_str(std::string *result, const T1 &delim, const T2 &s)
{
    if (result->empty()) {
        *result = s;
    }
    else {
        *result += delim;
        *result += s;
    }
}

template<class Container, typename T>
inline std::string join_strings(const Container &v, const T &delim)
{
    std::string buf;
    for (const std::string &s : v) {
        if (buf != "") buf += delim;
        buf += s;
    }
    return buf;
}

template<class Container, typename F, typename T>
inline std::string join_elems(const Container &v, F f, const T &delim)
{
    std::string buf;
    for (const auto &elem : v) {
        if (buf != "") buf += delim;
        buf += f(elem);
    }
    return buf;
}

template<class Container, typename T>
inline std::string join_to_string(const Container &v, const T &delim)
{
    std::string buf;
    for (const auto &elem : v) {
        if (buf != "") buf += delim;
        buf += std::to_string(elem);
    }
    return buf;
}

}  // namespace util
}  // namespace croquis
