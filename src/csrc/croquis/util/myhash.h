// Utility functions for hashing.
//
// NOTE: libstdc++ uses identity function for std::hash<int> (Yikes!).

#pragma once

#include <stdint.h>  // uint64_t
#include <string.h>  // memcpy

#include <functional>  // hash
#include <utility>     // pair
#include <vector>

namespace croquis {
namespace util {

template<class T>
inline uint32_t unaligned_load32(const T *p)
{
    uint32_t v;
    memcpy(&v, p, sizeof(uint32_t));
    return v;
}

template<class T>
inline uint64_t unaligned_load64(const T *p)
{
    uint64_t v;
    memcpy(&v, p, sizeof(uint64_t));
    return v;
}

template<class T>
struct myhash : public std::hash<T> { };

// Logic stolen from Hash128to64() inside CityHash.
inline size_t hash_combine(size_t hash1, size_t hash2)
{
    const size_t mul = 0x9ddfea08eb382d69ULL;
    size_t a = (hash1 ^ hash2) * mul;
    a ^= (a >> 47);
    size_t b = (hash2 ^ a) * mul;
    b ^= (b >> 47);
    b *= mul;
    return b;
}

template<class T1, class T2>
struct myhash<std::pair<T1, T2>> {
    size_t operator()(const std::pair<T1, T2>& p) const
    {
        const size_t hash1 = myhash<T1>()(p.first);
        const size_t hash2 = myhash<T2>()(p.second);
        return hash_combine(hash1, hash2);
    }
};

template<class T>
struct myhash<std::vector<T>> {
    size_t operator()(const std::vector<T>& v) const
    {
        size_t hash = 0L;
        for (const auto &elem : v)
            hash = hash_combine(hash, myhash<T>()(elem));
        return hash;
    }
};

}  // namespace util
}  // namespace croquis
