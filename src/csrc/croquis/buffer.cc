// Accessors for Python-managed buffers.

#include "croquis/buffer.h"

#include <inttypes.h>  // PRId64
#include <stdint.h>  // INT32_MAX

#include <pybind11/pybind11.h>

#include "croquis/util/error_helper.h"
#include "croquis/util/macros.h"  // CHECK

namespace croquis {

namespace py = pybind11;

// Helper structs to print type names, because C++.
template<typename T> struct TypeNameStr;

#define CROQUIS_DECLARE_TYPENAME(type) \
    template<> struct TypeNameStr<type>{ \
        const char *operator()() { return #type; } \
    };

CROQUIS_DECLARE_TYPENAME(int)
CROQUIS_DECLARE_TYPENAME(int64_t)
CROQUIS_DECLARE_TYPENAME(float)
CROQUIS_DECLARE_TYPENAME(double)

// Helper function for human-friendly type names from Python buffer format.
// See: https://docs.python.org/3/library/array.html
static std::string readable_format_string(const std::string &fmt)
{
    const char *type = nullptr;
    if (fmt == "b") type = "signed char";
    if (fmt == "B") type = "unsigned char";
    if (fmt == "h") type = "signed short";
    if (fmt == "H") type = "unsigned short";
    if (fmt == "i") type = "signed int";
    if (fmt == "I") type = "unsigned int";
    if (fmt == "l") type = "signed long";
    if (fmt == "L") type = "unsigned long";
    if (fmt == "q") type = "signed long long";
    if (fmt == "Q") type = "unsigned long long";
    if (fmt == "f") type = "float";
    if (fmt == "d") type = "double";

    if (type != nullptr) return std::string(type) + " (format '" + fmt + "')";
    return "format '" + fmt + "'";
}

template<typename T>
Buffer1D<T>::Buffer1D(const std::string &name, const py::buffer_info &info)
    : name_(name)
{
    if (info.format != py::format_descriptor<T>::format()) {
        util::throw_value_error(
            "%s: Expected %s (format '%s') but received %s.",
            name.c_str(),
            TypeNameStr<T>()(),
            py::format_descriptor<T>::format().c_str(),
            readable_format_string(info.format).c_str());
    }

    if (info.size > INT32_MAX) {
        util::throw_value_error(
            "%s: Buffer size too big (%zd items)", name.c_str(), info.size);
    }

    ptr_ = (T *) (info.ptr);
    if (info.ndim < 0 || info.ndim > 1) {
        util::throw_value_error(
            "%s: Buffer1D supports max 1 dimension (given %zd)",
            name.c_str(), info.ndim);
    }

    if (info.ndim == 0) {
        shape = 1;
        stride = 0;
    }
    else {
        shape = info.shape[0];
        CHECK(info.strides[0] % sizeof(T) == 0);  // Sanity check.
        int64_t s = info.strides[0] / sizeof(T);
        if (s < INT32_MIN || s > INT32_MAX) {
            util::throw_value_error(
                "%s: Buffer stride too big (%zd bytes)",
                name.c_str(), info.strides[0]);
        }
        stride = s;
    }
}

template<typename T>
Buffer2D<T>::Buffer2D(const std::string &name, const py::buffer_info &info)
    : name_(name)
{
    if (info.format != py::format_descriptor<T>::format()) {
        util::throw_value_error(
            "%s: Expected %s (format '%s') but received %s.",
            name.c_str(),
            TypeNameStr<T>()(),
            py::format_descriptor<T>::format().c_str(),
            readable_format_string(info.format).c_str());
    }

    if (info.size > INT32_MAX) {
        util::throw_value_error(
            "%s: Buffer size too big (%zd items)", name.c_str(), info.size);
    }

    ptr_ = (T *) (info.ptr);
    if (info.ndim < 0 || info.ndim > 2) {
        util::throw_value_error(
            "%s: Buffer2D supports max 2 dimensions (given %zd)",
            name.c_str(), info.ndim);
    }

    shape[0] = shape[1] = 1;
    strides[0] = strides[1] = 0;

    for (int i = 0; i < info.ndim; i++) {
        shape[i + 2 - info.ndim] = info.shape[i];
        CHECK(info.strides[i] % sizeof(T) == 0);  // Sanity check.
        int64_t stride = info.strides[i] / sizeof(T);
        if (stride < INT32_MIN || stride > INT32_MAX) {
            util::throw_value_error(
                "%s: Buffer stride too big (%zd bytes)",
                name.c_str(), info.strides[i]);
        }
        strides[i + 2 - info.ndim] = stride;
    }

    incrs[1] = strides[1];
    incrs[0] = strides[0] - (incrs[1] * (shape[1] - 1));
}

#if 0
// Instantiate necessary templates.
template class Buffer1D<float>;
template class Buffer1D<double>;
template class Buffer1D<int32_t>;
template class Buffer1D<int64_t>;

template class Buffer2D<float>;
template class Buffer2D<double>;
template class Buffer2D<int32_t>;
template class Buffer2D<int64_t>;
#endif

// Helper function for constructor.
// See: https://docs.python.org/3/library/array.html
static BufferType get_buffer_type(const std::string &name,
                                  const py::buffer_info &info,
                                  GenericBuffer2D::BufferKind kind)
{
    BufferType type;
    bool ok;

    if (info.format.size() == 1) {
        const char fmt = info.format[0];

        ok = true;
        switch (fmt) {
            case 'b': type = BufferType::INT8; break;
            case 'B': type = BufferType::UINT8; break;
            case 'h': type = BufferType::INT16; break;
            case 'H': type = BufferType::UINT16; break;
            case 'i': type = BufferType::INT32; break;
            case 'I': type = BufferType::UINT32; break;
            case 'l': type = BufferType::INT64; break;
            case 'L': type = BufferType::UINT64; break;

            // Apparently l/L and q/Q are the same on 64-bit architecture?
            case 'q': type = BufferType::INT64; break;
            case 'Q': type = BufferType::UINT64; break;

            case 'f': type = BufferType::FLOAT; break;
            case 'd': type = BufferType::DOUBLE; break;
            default: ok = false;
        }
    }
    else {
        ok = false;
    }

    if (!ok) {
        util::throw_value_error(
            "%s: Unsupported element type: %s.",
            name.c_str(), readable_format_string(info.format).c_str());
    }

    if (kind == GenericBuffer2D::INTEGER_TYPE &&
        (type == BufferType::FLOAT || type == BufferType::DOUBLE)) {
        util::throw_value_error(
            "%s: Only integer types are allowed, but received %s.",
            name.c_str(), readable_format_string(info.format).c_str());
    }

    return type;
}

GenericBuffer2D::GenericBuffer2D(const std::string &name,
                                 const py::buffer_info &info,
                                 BufferKind kind)
    : name_(name), ptr_((char *) (info.ptr)),
      type(get_buffer_type(name, info, kind))
{
    if (info.size > INT32_MAX) {
        util::throw_value_error(
            "%s: Buffer size too big (%zd items)", name.c_str(), info.size);
    }

    if (info.ndim < 0 || info.ndim > 2) {
        util::throw_value_error(
            "%s: GenericBuffer2D supports max 2 dimensions (given %zd)",
            name.c_str(), info.ndim);
    }

    shape[0] = shape[1] = 1;
    strides[0] = strides[1] = 0;

    for (int i = 0; i < info.ndim; i++) {
        shape[i + 2 - info.ndim] = info.shape[i];
        int64_t stride = info.strides[i];  // in bytes
        if (stride < INT32_MIN || stride > INT32_MAX) {  // Sanity check.
            util::throw_value_error(
                "%s: Buffer stride too big (%" PRId64 " bytes)",
                name.c_str(), stride);
        }
        strides[i + 2 - info.ndim] = stride;
    }
}

std::pair<double, double> GenericBuffer2D::minmax() const
{
    switch (type) {
        case BufferType::INT8: return minmax_helper<int8_t>();
        case BufferType::UINT8: return minmax_helper<uint8_t>();
        case BufferType::INT16: return minmax_helper<int16_t>();
        case BufferType::UINT16: return minmax_helper<uint16_t>();
        case BufferType::INT32: return minmax_helper<int32_t>();
        case BufferType::UINT32: return minmax_helper<uint32_t>();
        case BufferType::INT64: return minmax_helper<int64_t>();
        case BufferType::UINT64: return minmax_helper<uint64_t>();
        case BufferType::FLOAT: return minmax_helper<float>();
        case BufferType::DOUBLE: return minmax_helper<double>();
    }
#ifdef __GNUC__
    __builtin_unreachable();
#endif
}

template<typename T> std::pair<T, T> GenericBuffer2D::minmax_helper() const
{
    int shape0 = shape[0], shape1 = shape[1];
    int incr0 = strides[0] - (shape1 * strides[1]);
    int incr1 = strides[1];

    const char *ptr = ptr_;
    T m = *(const T *) ptr;
    T M = *(const T *) ptr;

    for (int i = 0; i < shape0; i++, ptr += incr0) {
        for (int j = 0; j < shape1; j++, ptr += incr1) {
            T val = *(const T *) ptr;
            if (val < m) m = val;
            if (val > M) M = val;
        }
    }

    return std::make_pair(m, M);
}

} // namespace croquis
