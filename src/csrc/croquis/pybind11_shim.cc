// Testing pybind11 !!
// https://pybind11.readthedocs.io/en/master/basics.html

#include "croquis/buffer.h"
#include "croquis/canvas.h"
#include "croquis/figure_data.h"
#include "croquis/message.h"
#include "croquis/plotter.h"
#include "croquis/thr_manager.h"
#include "croquis/util/string_printf.h"

#include <pybind11/pybind11.h>
#include <pybind11/functional.h>
#include <pybind11/stl.h>

namespace py = pybind11;

PYBIND11_MODULE(_csrc, m) {
    using croquis::util::string_printf;

    m.doc() = "Internal module for croquis";

    py::class_<croquis::ThrManager>(m, "ThrManager")
        .def(py::init<int, croquis::ThrManager::PyCallback_t, double, int>(),
             py::return_value_policy::reference)
        .def("wthr_entry_point", &croquis::ThrManager::wthr_entry_point,
             py::call_guard<py::gil_scoped_release>());

// TODO: Do we need this?
#if 0
    // Helper function to shut down thread manager.
    m.def("shutdown_tmgr", &croquis::ThrManager::shutdown,
          "Helper function to shut down existing ThrManager.");
#endif

    py::class_<croquis::MessageData>(m, "MessageData", py::buffer_protocol())
        .def_property_readonly(
            "name", [](const croquis::MessageData &data) {
                return data.name;
            }
        )
        .def_buffer([](croquis::MessageData &data) {
            // Better to use `unsigned char` here, because otherwise the buffer
            // will be `signed char` and it won't be compatible with Python
            // `bytes` type.
            //
            // Can check in Python by:
            //      m = memoryview(data)
            //      print(m.format)  # 'b' for (char *)
            //                       # 'B' for (unsigned char *)
            //      m[:3] = b'foo'   # Needs 'B'.
            return py::buffer_info((unsigned char *) data.get(), data.size());
        })
        .def("__repr__", [](const croquis::MessageData &data) {
            return string_printf(
                "<MessageData '%s' %p size=%zu>",
                data.name.c_str(), data.get(), data.size());
        });

    py::class_<croquis::CanvasConfig>(m, "CanvasConfig")
        .def(py::init<int, int, int, double, double, double, double>())
        .def_readonly("id", &croquis::CanvasConfig::id)
        .def_readonly("w", &croquis::CanvasConfig::w)
        .def_readonly("h", &croquis::CanvasConfig::h)
        .def_readonly("x0", &croquis::CanvasConfig::x0)
        .def_readonly("y0", &croquis::CanvasConfig::y0)
        .def_readonly("x1", &croquis::CanvasConfig::x1)
        .def_readonly("y1", &croquis::CanvasConfig::y1);

    py::class_<croquis::Plotter>(m, "Plotter")
        .def(py::init<>())
        .def("add_rectangular_line_data",
            [](croquis::Plotter &p,
               py::buffer X, py::buffer Y, py::buffer colors,
               int line_cnt, int pts_cnt,
               float marker_size, float line_width,
               float highlight_line_width) {
                p.add_figure_data<croquis::RectangularLineData>(
                    X.request(), Y.request(), colors.request(), line_cnt, pts_cnt,
                    marker_size, line_width, highlight_line_width);
            },
            py::call_guard<py::gil_scoped_release>()
        )
        .def("add_freeform_line_data",
            [](croquis::Plotter &p,
               py::buffer X, py::buffer Y, py::buffer start_idxs,
               py::buffer colors,
               int item_cnt, int total_pts_cnt,
               float marker_size, float line_width,
               float highlight_line_width) {
                p.add_figure_data<croquis::FreeformLineData>(
                    X.request(), Y.request(), start_idxs.request(),
                    colors.request(),
                    item_cnt, total_pts_cnt,
                    marker_size, line_width, highlight_line_width);
            },
            py::call_guard<py::gil_scoped_release>()
        )
        .def("get_address",
             [](const croquis::Plotter &p) { return (uintptr_t) &p; })
        .def_property_readonly(
            "sm_version", [](const croquis::Plotter &p) {
                return p.get_sm_version();
            }
        )
        .def("cell_init_handler", &croquis::Plotter::cell_init_handler,
             py::call_guard<py::gil_scoped_release>())
        .def("zoom_req_handler", &croquis::Plotter::zoom_req_handler,
             py::call_guard<py::gil_scoped_release>())
        // Called by _axis_req_handler() to remember the current canvas config.
        .def("get_canvas_config", &croquis::Plotter::get_canvas_config)
        .def("init_selection_map", [](croquis::Plotter &p) {
            auto result = p.init_selection_map();
            return py::memoryview::from_buffer(
                result.first, { result.second }, { 1 /* stride */ });
        })
        .def("start_selection_update",
             &croquis::Plotter::start_selection_update)
        .def("end_selection_update", &croquis::Plotter::end_selection_update)
        .def("acknowledge_seqs", &croquis::Plotter::acknowledge_seqs,
             py::call_guard<py::gil_scoped_release>())
        .def("tile_req_handler", &croquis::Plotter::tile_req_handler,
             py::call_guard<py::gil_scoped_release>())
        .def("check_error", &croquis::Plotter::check_error);
}
