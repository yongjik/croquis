// Thread pool manager.
// The threads are shared by all plots inside the same process.

#pragma once

#include <stdio.h>
#include <stdint.h>  // uintptr_t

#include <condition_variable>
#include <functional>
#include <memory>  // unique_ptr
#include <mutex>
#include <random>  // mt19937
#include <thread>
#include <utility>  // forward
#include <vector>

#include "croquis/message.h"
#include "croquis/task.h"
#include "croquis/util/macros.h"  // CHECK

namespace croquis {

class ThrManager;
extern ThrManager *tmgr_;  // Singleton.

class WorkThr {
  private:
    friend class ThrManager;

    const int idx_;
    const std::thread::id tid_;

    // Random number generator for scheduling.  (This is probably overkill, but
    // it's hard to find a better RNG that's easy to use...)
    std::mt19937 gen_;

  public:
    explicit WorkThr(int idx);
    void run();
};

class ThrManager {
  public:
    // A generic callback, telling the Python code to send the data back to FE.
    //
    // Arguments are: key (address of the sender object);
    //                data as json string;
    //                optional binary data (up to two).
    typedef std::function<bool(uintptr_t, const std::vector<std::string> &,
                               std::unique_ptr<MessageData>,
                               std::unique_ptr<MessageData>)>
            PyCallback_t;

    const int nthreads;

  private:
    friend class WorkThr;

    const std::thread::id mgr_tid_;
    std::vector<std::unique_ptr<WorkThr>> wthrs_;

    PyCallback_t py_callback_;

    // Mutex and condition variable to guard task_queue_.
    std::mutex m_;
    std::condition_variable cv_;
    std::condition_variable shutdown_cv_;

    bool shutdown_ = false;

    // All tasks with SCHD_FIFO constitute a circular doubly-linked list.  This
    // points to the head (i.e., the next task to execute).
    Task *fifo_queue_ = nullptr;
    int fifo_queue_size_ = 0;  // For debugging.

    // All remaining tasks also constitute another circular doubly-linked list,
    // in order to avoid starvation.  This points to the head.
    Task *low_prio_queue_ = nullptr;

    // Tasks in SCHD_LIFO are stored here as a max-heap on enqueue_time_.
    // TODO: Actually, since an "expedited" task can only move to the head of
    //       the queue, we don't need a full-fledged max-heap.  We can simply
    //       use a doubly linked list!  -_-
    std::vector<Task *> lifo_heap_;
    std::vector<Task *> lifo_low_heap_;

  public:
    ThrManager(int nthreads, PyCallback_t py_callback,
               double start_time, int log_fd);

#if 0
    // Shuts down the existing thread manager.
    // TODO: Currently not used.  Do we need this?
    static void shutdown();
#endif

    // Called by Python for each worker thread.
    void wthr_entry_point(int idx);

    // Enqueue a task: can be called by any thread.
    //
    // If the task has any prerequiste tasks, it won't be actually "enqueued" in
    // any data structure - it will be enqueued when `prereq_cnt_` becomes zero.
    static void enqueue(std::unique_ptr<Task> task);

    // Enqueue a task, but do not transfer ownership.
    static void enqueue_no_delete(Task *task);

    // Convenience functions.
    template<typename T, typename... Args>
    static void enqueue(Args&&... args) {
        enqueue(std::make_unique<T>(std::forward<Args>(args)...));
    }

    template<typename T>
    static Task *enqueue_lambda(
                     T &&fn,
                     Task::ScheduleClass sched_class = Task::SCHD_FIFO,
                     Task *dep = nullptr) {
        std::unique_ptr<Task> task =
            make_lambda_task(std::move(fn), sched_class, dep);
        Task *t = task.get();
        enqueue(std::move(task));
        return t;
    }

    template<typename T>
    static std::unique_ptr<Task> enqueue_lambda_no_delete(
                     T &&fn,
                     Task::ScheduleClass sched_class,
                     Task *dep = nullptr) {
        std::unique_ptr<Task> task =
            make_lambda_task(std::move(fn), sched_class, dep);
        enqueue_no_delete(task.get());
        return task;
    }

    // Expedite a LIFO task so that it has the highest priority among its
    // scheduling class.  See Task::ScheduleClass for discussion.
    static void expedite_task(Task *t) { tmgr_->do_expedite_task(t); }

  private:
    // Internal helper functions.
    void do_enqueue(Task *t);
    void do_expedite_task(Task *t);

    // Called by WorkThr: may return nullptr if we're shutting down.
    Task *dequeue_task(WorkThr *wthr);

    friend void set_task_ready(Task *t);

  public:
    // Call the python callback to send a message: can be called by any thread.
    //
    // (Not really relevant to ThrManager, but this seems the most convenient
    // place to have this...)
    //
    // `dict` contains key-value pairs in the format "x=y", e.g.,
    // {"msg=test_message", "foo=hello", "#bar=3"}.
    // (Use '#' in front of the key to create a numeric value.)
    bool send_msg(uintptr_t obj_id, const std::vector<std::string> &dict,
                  std::unique_ptr<MessageData> data1 = nullptr,
                  std::unique_ptr<MessageData> data2 = nullptr);

    template<typename T>
    bool send_msg(const T *obj, const std::vector<std::string> &dict,
                  std::unique_ptr<MessageData> data1 = nullptr,
                  std::unique_ptr<MessageData> data2 = nullptr) {
        return send_msg((uintptr_t) obj, dict,
                        std::move(data1), std::move(data2));
    }
};

}  // namespace croquis
