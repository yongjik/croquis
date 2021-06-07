// Accessors for Python-managed buffers.

#pragma once

#include <inttypes.h>  // PRId64
#include <math.h>  // isnan, nearbyint

#include <string>
#include <utility>  // pair

#include "croquis/util/error_helper.h"  // throw_value_error
#include "croquis/util/macros.h"  // DIE_MSG

// Forward declaration.
namespace pybind11 {
struct buffer_info;
}  // namespace pybind11

namespace croquis {

namespace py = pybind11;

// TODO: Buffer1D and Buffer2D are not currently used.
template<typename T> class Buffer1D {
  private:
    const std::string name_;
    T *ptr_;

    // static inline bool is_nan(T val);

  public:
    // Basically const.
    int shape;
    int stride;

    // `name` is only for debugging and error messages.
    Buffer1D(const std::string &name, const py::buffer_info &info);

    T *get() { return ptr_; }
    const T *get() const { return ptr_; }

    T *get(int i)
    { return ptr_ + i * stride; }
    const T *get(int i) const
    { return ptr_ + i * stride; }

    // Find min/max values among non-NaN values.
    inline std::pair<T, T> minmax() const;
};

template<typename T> std::pair<T, T> Buffer1D<T>::minmax() const
{
    const T *ptr = ptr_;
    T m = *ptr, M = *ptr;

    for (int i = 0; i < shape; i++, ptr += stride) {
        T val = *ptr;
        if (val < m) m = val;
        if (val > M) M = val;
    }

    return std::make_pair(m, M);
}

template<typename T> class Buffer2D {
  private:
    const std::string name_;
    T *ptr_;

    // static inline bool is_nan(T val);

  public:
    // Basically const.
    int shape[2];
    int strides[2];
    int incrs[2];  // Increments when we're traversing elements.

    // `name` is only for debugging and error messages.
    Buffer2D(const std::string &name, const py::buffer_info &info);

    T *get() { return ptr_; }
    const T *get() const { return ptr_; }

    T *get(int i, int j)
    { return ptr_ + i * strides[0] + j * strides[1]; }
    const T *get(int i, int j) const
    { return ptr_ + i * strides[0] + j * strides[1]; }

    // Find min/max values among non-NaN values.
    inline std::pair<T, T> minmax() const;
};

#if 0
template<> inline bool Buffer2D<float>::is_nan(float val) { return isnan(val); }
template<> inline bool Buffer2D<double>::is_nan(double val) { return isnan(val); }
template<> inline bool Buffer2D<int32_t>::is_nan(int32_t val) { return false; }
template<> inline bool Buffer2D<int64_t>::is_nan(int64_t val) { return false; }
#endif

template<typename T> std::pair<T, T> Buffer2D<T>::minmax() const
{
    int shape0 = shape[0], shape1 = shape[1];
    int incr0 = strides[0] - (shape1 * strides[1]);
    int incr1 = strides[1];

    const T *ptr = ptr_;
    T m = *ptr, M = *ptr;

    for (int i = 0; i < shape0; i++, ptr += incr0) {
        for (int j = 0; j < shape1; j++, ptr += incr1) {
            T val = *ptr;
            if (val < m) m = val;
            if (val > M) M = val;
        }
    }

    return std::make_pair(m, M);
}

// Type-agnostic buffer classes to prevent template instantiation blowup.
// TODO: Let's just use these classes and remove Buffer1D/Buffer2D?

enum class BufferType {
    INT8,
    UINT8,
    INT16,
    UINT16,
    INT32,
    UINT32,
    INT64,
    UINT64,
    FLOAT,
    DOUBLE,
};

class GenericBuffer2D {
  private:
    const std::string name_;

    // We use `char *` so that pointer arithmetic is easier.  The caller should
    // cast it to the appropriate type.
    char *const ptr_;

  public:
    const BufferType type;

    // Basically const.
    // For `strides`, unit is in bytes.  I.e., strides[1] == 8 means the next
    // element is 8 *bytes* to the right.
    int shape[2];
    int strides[2];

    enum BufferKind {
        GENERIC = 0,

        // For offsets: any integer types are OK, float/double are not allowed.
        INTEGER_TYPE = 1,

        // For colors: only allow UINT8/FLOAT/DOUBLE.  For FLOAT/DOUBLE, the
        // value should be in range [0.0, 1.0].
        COLOR = 2,
    };

    // `name` is only for debugging and error messages.
    GenericBuffer2D(const std::string &name, const py::buffer_info &info,
                    BufferKind kind = BufferKind::GENERIC);

    char *get() { return ptr_; }
    const char *get() const { return ptr_; }

    char *get(int i, int j)
    { return ptr_ + i * strides[0] + j * strides[1]; }
    const char *get(int i, int j) const
    { return ptr_ + i * strides[0] + j * strides[1]; }

    // Get the value after applying transformation (x -> Ax + b)
    float get_transformed(const char *ptr, float A, float b) const {
        switch (type) {
            case BufferType::INT8:   return A * (*(int8_t *) ptr) + b;
            case BufferType::UINT8:  return A * (*(uint8_t *) ptr) + b;
            case BufferType::INT16:  return A * (*(int16_t *) ptr) + b;
            case BufferType::UINT16: return A * (*(uint16_t *) ptr) + b;
            case BufferType::INT32:  return A * (*(int32_t *) ptr) + b;
            case BufferType::UINT32: return A * (*(uint32_t *) ptr) + b;
            case BufferType::INT64:  return A * (*(int64_t *) ptr) + b;
            case BufferType::UINT64: return A * (*(uint64_t *) ptr) + b;
            case BufferType::FLOAT:  return A * (*(float *) ptr) + b;
            case BufferType::DOUBLE: return A * (*(double *) ptr) + b;
        }
#ifdef __GNUC__
        __builtin_unreachable();
#endif
    }

    // TODO: We don't need color_util.h any more?
    uint8_t get_color(const char *ptr) const {
        switch (type) {
            case BufferType::INT8: return *(int8_t *) ptr;
            case BufferType::UINT8: return *(uint8_t *) ptr;
            case BufferType::INT16:  return *(int16_t *) ptr;
            case BufferType::UINT16: return *(uint16_t *) ptr;
            case BufferType::INT32:  return *(int32_t *) ptr;
            case BufferType::UINT32: return *(uint32_t *) ptr;
            case BufferType::INT64:  return *(int64_t *) ptr;
            case BufferType::UINT64: return *(uint64_t *) ptr;

            case BufferType::FLOAT:
                return nearbyintf(
                        fmaxf(0.0f, fminf(*(float *) ptr, 1.0f)) * 255.0f);

            case BufferType::DOUBLE:
                return nearbyint(fmax(0.0, fmin(*(double *) ptr, 1.0)) * 255.0);

            default:
                DIE_MSG("Unsupported data type!");
        }
    }

    // TODO: Support proper alpha channel.
    uint32_t get_argb(int row) const {
        const char *ptr = get(row, 0);
        uint32_t r = get_color(ptr);
        ptr += strides[1];
        uint32_t g = get_color(ptr);
        ptr += strides[1];
        uint32_t b = get_color(ptr);
        return 0xff000000 + (r << 16) + (g << 8) + b;
    }

    // Get the value as integer, and validate that it's within [0, limit).
    int64_t get_intval(const char *ptr, int64_t limit) const {
        int64_t val;

        switch (type) {
            case BufferType::INT8:   val = *(int8_t *) ptr; break;
            case BufferType::UINT8:  val = *(uint8_t *) ptr; break;
            case BufferType::INT16:  val = *(int16_t *) ptr; break;
            case BufferType::UINT16: val = *(uint16_t *) ptr; break;
            case BufferType::INT32:  val = *(int32_t *) ptr; break;
            case BufferType::UINT32: val = *(uint32_t *) ptr; break;
            case BufferType::INT64:  val = *(int64_t *) ptr; break;
            case BufferType::UINT64: val = *(uint64_t *) ptr; break;
            default: DIE_MSG("Unsupported data type!");
        }

        if (val < 0 || val >= limit) {
            util::throw_value_error(
                "%s: Invalid value %" PRId64 " - must be in [0, %" PRId64 ").",
                name_.c_str(), val, limit);
        }

        return val;
    }

    int64_t get_intval(int i, int j, int64_t limit) const
    { return get_intval(get(i, j), limit); }

    // Find min/max values among non-NaN values.
    std::pair<double, double> minmax() const;

  private:
    template<typename T> std::pair<T, T> minmax_helper() const;
};

} // namespace croquis
