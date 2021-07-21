# The main CMakeLists.txt
# Main idea copied from: https://github.com/dev-cafe/cmake-cookbook/blob/master/chapter-09/recipe-06/README.md

# Needed for add_compile_definitions().
cmake_minimum_required(VERSION 3.12)

project(croquis VERSION 0.0.1 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# I don't know what would be the best instruction set to target, but given that
# AVX2 was introduced by Haswell processors on 2013, it should be safe enough.
option(ENABLE_AVX2 "Compile with AVX2 instructions" ON)
if(ENABLE_AVX2)
    if(MSVC)
        # Not sure if this works ...
        add_compile_options("/arch:AVX2")
    else()
        add_compile_options("-march=haswell" "-mtune=generic")
    endif()
endif()

if(APPLE)
    # On Mac OS, std::experimental::optional is not available with C++14 - the
    # easiest solution seems to be just use C++17.
    set(CMAKE_CXX_STANDARD 17)
    add_compile_definitions(USE_STD_OPTIONAL)

    # (Hopefully) support older versions of Mac OS.
    # cf. https://github.com/MacPython/wiki/wiki/Spinning-wheels
    set(CMAKE_OSX_DEPLOYMENT_TARGET 10.9)

    # Seems like we need this flag on Mac OS.
    # See also: https://pybind11.readthedocs.io/en/stable/compiling.html#building-manually
    #           https://github.com/pybind/pybind11/blob/v2.6.2/tools/pybind11Common.cmake
    set(CMAKE_SHARED_LINKER_FLAGS "-undefined dynamic_lookup")
else()
    set(CMAKE_CXX_STANDARD 14)
    add_compile_definitions(USE_EXPERIMENTAL_OPTIONAL)

    # Add -Bsymbolic-functions option.
    # cf. https://blog.flameeyes.eu/2012/10/symbolism-and-elf-files-or-what-does-bsymbolic-do/
    #
    # If f() in our library calls another function g() in our library,
    # -Bsymbolic-functions ensures that we always call the version of g() that
    # exists inside our library, not some other g() that happens to have the
    # same name in some other shared library.
    #
    # TODO: How do I do the same thing on Linux?
    set(CMAKE_SHARED_LINKER_FLAGS "-Wl,-Bsymbolic-functions")

    # Apparently, this is required to use PRId64 in *ancient* compilers (gcc
    # 8.3.1) used by manylinux2010 Docker image.
    add_compile_definitions(__STDC_FORMAT_MACROS)
endif()

find_package(Python3 COMPONENTS Interpreter Development)

set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")

# We can use this, but it brings in more dependency, and it's harder to control
# options for individual source files.
#
#   > find_package(pybind11)
#   > pybind11_add_module(csrc csrc/pybind11_shim.cc)
#
# So let's do this.  The logic is copied from FindPythonLibsNew.cmake, inside
# pybind11 source tree.
function(get_python_config CMD_STRING OUTPUT_VAR)
    execute_process(COMMAND "python3" "-c" "${CMD_STRING}"
        RESULT_VARIABLE _rc
        OUTPUT_VARIABLE _output
        ERROR_VARIABLE _stderr
        OUTPUT_STRIP_TRAILING_WHITESPACE)

    set(${OUTPUT_VAR} "${_output}" PARENT_SCOPE)

    if(NOT _rc MATCHES 0)
        message(FATAL_ERROR "Cannot run command: ${CMD_STRING}\n${_stderr}")
    endif()
endfunction()

get_python_config(
    "import distutils.sysconfig as s; print(s.get_python_inc(plat_specific=True))"
    PYTHON_INCLUDE_DIR)

get_python_config(
    "import pybind11; print(pybind11.get_include())"
    PYBIND11_INCLUDE_DIR)

# E.g., ".cpython-38-x86_64-linux-gnu.so"
get_python_config(
    "import distutils.sysconfig as s; print(s.get_config_var('SO'))"
    PYTHON_SO_SUFFIX)

# message("PYTHON_INCLUDE_DIR = ${PYTHON_INCLUDE_DIR}")
# message("PYBIND11_INCLUDE_DIR = ${PYBIND11_INCLUDE_DIR}")
# message("PYTHON_SO_SUFFIX = ${PYTHON_SO_SUFFIX}")

# Files that can be compiled without pybind11/Python dependency: listed
# separately for running tests.
#
# TODO: Use add_subdirectory()?
set(CSRC_STATIC_SOURCES
    csrc/croquis/grayscale_buffer.cc
    csrc/croquis/freeform_line_data.cc
    csrc/croquis/intersection_finder.cc
    csrc/croquis/message.cc
    csrc/croquis/plotter.cc
    csrc/croquis/rectangular_line_data.cc
    csrc/croquis/rgb_buffer.cc
    csrc/croquis/util/logging.cc
    csrc/croquis/util/string_printf.cc
)

# TODO: How to specify this on Windows?
set_source_files_properties(
    csrc/croquis/grayscale_buffer.cc
    PROPERTIES COMPILE_FLAGS "-ffast-math")

set(CSRC_SOURCES ${CSRC_STATIC_SOURCES})
list(APPEND CSRC_SOURCES
    csrc/croquis/buffer.cc
    csrc/croquis/pybind11_shim.cc
    csrc/croquis/thr_manager.cc
    csrc/croquis/util/error_helper.cc
)

add_library(_csrc SHARED ${CSRC_SOURCES})
set_property(TARGET _csrc PROPERTY PREFIX "")
set_property(TARGET _csrc PROPERTY SUFFIX "${PYTHON_SO_SUFFIX}")
set_property(TARGET _csrc PROPERTY CXX_VISIBILITY_PRESET "hidden")
target_include_directories(_csrc
    PRIVATE "csrc"
    PRIVATE "${PYTHON_INCLUDE_DIR}"
    PRIVATE "${PYBIND11_INCLUDE_DIR}"
)

# Static library for testing.
add_library(csrc_static ${CSRC_STATIC_SOURCES})
target_include_directories(csrc_static
    PRIVATE "csrc"
    PRIVATE "${PYBIND11_INCLUDE_DIR}"
)

# Copy the shared library to src/croquis/lib/ so that Python can import it
# inside the source tree - handy for development.
add_custom_command(TARGET _csrc POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
            $<TARGET_FILE:_csrc> "${CMAKE_SOURCE_DIR}/croquis/lib/"
)

# Run webpack to create the js bundle.
set(JS_BUNDLE_DIR "${CMAKE_BINARY_DIR}/js_bundle")
add_custom_target(webpack
    COMMAND ${CMAKE_COMMAND} -E make_directory "${JS_BUNDLE_DIR}"
    COMMAND "webpack" "-o" "${JS_BUNDLE_DIR}"
    COMMAND "terser" "${JS_BUNDLE_DIR}/croquis_fe_dev.js"
            "-o" "${JS_BUNDLE_DIR}/croquis_fe.js"  # Minified js file.
            "--compress" "--mangle"
            "--source-map" "url='croquis_fe.js.map',content='${JS_BUNDLE_DIR}/croquis_fe_dev.js.map'"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/js"
    VERBATIM
)

add_custom_target(wheel
    COMMAND "python3" "${CMAKE_SOURCE_DIR}/../setup.py"
            "-CMAKE" $<TARGET_FILE:_csrc> "${JS_BUNDLE_DIR}"
            "clean" "bdist_wheel"
)
add_dependencies(wheel _csrc)
add_dependencies(wheel webpack)

#-------------------------------------------------
# Tests.
# TODO: Add as a separate directory.
#
# NOTE: Please run the test as "make check" because apparently CMake doesn't
#       build test targets if you run "make test".  Seriously?
# See: https://stackoverflow.com/questions/733475/cmake-ctest-make-test-doesnt-build-tests

enable_testing()
add_custom_target(check COMMAND "${CMAKE_CTEST_COMMAND}")

function(cpp_test TEST_SRC)
    get_filename_component(test_name "${TEST_SRC}" NAME_WLE)
    add_executable("${test_name}" "${TEST_SRC}")
    target_include_directories("${test_name}" PRIVATE "csrc")
    target_link_libraries("${test_name}" csrc_static)

    add_test(NAME "${test_name}" COMMAND $<TARGET_FILE:${test_name}>)
    add_dependencies(check "${test_name}")

    message("test name = ${test_name}")
    message("target binary = " $<TARGET_FILE:${test_name}>)
endfunction()

function(py_test TEST_SRC)
    get_filename_component(test_name "${TEST_SRC}" NAME_WLE)
    add_test(NAME "${test_name}" COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/${TEST_SRC}")

    message("test name = ${test_name}")
endfunction()

cpp_test(csrc/croquis/tests/grayscale_buffer_test.cc)
cpp_test(csrc/croquis/tests/line_algorithm_test.cc)
py_test(croquis/tests/axis_util_test.py)
py_test(croquis/tests/data_util_test.py)
