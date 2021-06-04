// Miscellaneous macros.

#pragma once

#include <stdio.h>
#include <stdlib.h>

#define DISALLOW_COPY_AND_MOVE(T) \
    T(const T &) = delete; \
    T(T &&) = delete; \
    T &operator=(const T &) = delete; \
    T &operator=(T &&) = delete

// Google-style.
#define CHECK(cond) \
    do { \
        if (!(cond)) { \
            fprintf(stderr, "Assertion failed (%s:%d): %s\n", \
                    __FILE__, __LINE__, #cond); \
            abort(); \
        } \
    } while (0)

#define DIE_MSG(msg) \
    do { \
        fprintf(stderr, "Assertion failed (%s:%d): %s\n", \
                __FILE__, __LINE__, msg); \
        abort(); \
    } while (0)
