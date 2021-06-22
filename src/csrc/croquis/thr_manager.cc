// Thread pool manager.

#include "croquis/thr_manager.h"

#include <inttypes.h>  // PRId64
#include <stdio.h>  // printf

#include <mutex>

#include <pybind11/pybind11.h>

#include "croquis/message.h"
#include "croquis/task.h"
#include "croquis/util/clock.h"  // microtime
#include "croquis/util/logging.h"  // init_logging
#include "croquis/util/macros.h"  // DIE_MSG

#define DEBUG_TMGR 0

namespace croquis {

namespace py = pybind11;

ThrManager *tmgr_ = nullptr;  // Singleton.
static thread_local int my_thr_idx_ = -1;  // TODO: Do we need this?

// A container class for helper functions for managing thread queue.
// (We need a class because they are accessing private members of Task.)
class ThrHelper {
  public:
    // Enqueue a task at the "last" position of a circularly linked list.
    static void enqueue_task(Task **queue, Task *t) {
        DBG_LOG1(DEBUG_TMGR, "Enqueueing task [%p] ...", t);

        if (*queue == nullptr) {
            *queue = t->next_ = t->prev_ = t;
            return;
        }

        Task *head = *queue;
        Task *last = head->prev_;
        t->prev_ = last;
        t->next_ = head;
        last->next_ = t;
        head->prev_ = t;
    }

    // Dequeue a task from the head.
    static Task *dequeue_task(Task **queue) {
        CHECK(*queue != nullptr);
        Task *t = *queue;
        remove_task(queue, t);
        return t;
    }

    // Remove a task from a linked list.
    static void remove_task(Task **queue, Task *t) {
        DBG_LOG1(DEBUG_TMGR, "Removing task [%p] from queue ...", t);

        Task *prev = t->prev_;
        Task *next = t->next_;
        t->prev_ = t->next_ = nullptr;

        if (t == next) {
            *queue = nullptr;
            return;
        }

        prev->next_ = next;
        next->prev_ = prev;
        if (t == *queue) *queue = next;
    }

    // Insert a task into a heap.
    static void heap_insert_task(std::vector<Task *> *heap, Task *t) {
        DBG_LOG1(DEBUG_TMGR, "Inserting task [%p] to heap ...", t);

        int64_t enqueue_time = t->enqueue_time_;
        int heap_idx = heap->size();
        heap->push_back(t);

        while (heap_idx > 0) {
            int parent_idx = (heap_idx - 1) / 2;
            Task *parent = (*heap)[parent_idx];
            if (parent->enqueue_time_ >= enqueue_time) break;

            parent->heap_idx_ = heap_idx;
            (*heap)[heap_idx] = parent;
            heap_idx = parent_idx;
        }

        t->heap_idx_ = heap_idx;
        (*heap)[heap_idx] = t;

#if DEBUG_TMGR
        DBG_LOG1(DEBUG_TMGR, "task [%p] heap_idx = %d", t, heap_idx);
        verify_heap(*heap);
#endif
    }

    // Possibly increase the priority of a task in a heap.
    static void heap_update_task(
                    std::vector<Task *> *heap, Task *t, int64_t new_time) {
        DBG_LOG1(DEBUG_TMGR,
                 "Updating task [%p] from %" PRId64 " to %" PRId64 " ...",
                 t, t->enqueue_time_, new_time);

        // Since `new_time` is actually the current time, it should always be
        // greater than the previous value ... but let's double-check, just in case.
        if (t->enqueue_time_ < new_time)
            t->enqueue_time_ = new_time;
        else
            return;

        int heap_idx = t->heap_idx_;
        CHECK((*heap)[heap_idx] == t);

        while (heap_idx > 0) {
            int parent_idx = (heap_idx - 1) / 2;
            Task *parent = (*heap)[parent_idx];
            if (parent->enqueue_time_ >= new_time) break;

            parent->heap_idx_ = heap_idx;
            (*heap)[heap_idx] = parent;
            heap_idx = parent_idx;
        }

        t->heap_idx_ = heap_idx;
        (*heap)[heap_idx] = t;

#if DEBUG_TMGR
        DBG_LOG1(DEBUG_TMGR, "task [%p] heap_idx = %d", t, heap_idx);
        verify_heap(*heap);
#endif
    }

    // Remove a task from the heap.
    static void heap_remove_task(std::vector<Task *> *heap, Task *t) {
        DBG_LOG1(DEBUG_TMGR, "Removing task [%p] heap_idx = %d from heap ...",
                 t, t->heap_idx_);

        int heap_idx = t->heap_idx_;
        t->heap_idx_ = -1;
        Task *last = heap->back();
        heap->pop_back();

        if (last == t) return;  // This was the last element.

        CHECK((*heap)[heap_idx] == t);
        (*heap)[heap_idx] = last;
        int64_t last_time = last->enqueue_time_;

        // We don't know which way we need to fix the heap, so we'll try both.

        // Fix the heap going upward.
        while (heap_idx > 0) {
            int parent_idx = (heap_idx - 1) / 2;
            Task *parent = (*heap)[parent_idx];
            if (parent->enqueue_time_ >= last_time) break;

            parent->heap_idx_ = heap_idx;
            (*heap)[heap_idx] = parent;
            heap_idx = parent_idx;
        }

        // Fix the heap going downward.
        int heap_sz = heap->size();
        while (true) {
            int child_idx = 2 * heap_idx + 1;  // Left child.
            if (child_idx >= heap_sz) break;
            Task *child = (*heap)[child_idx];
            int64_t child_time = child->enqueue_time_;

            // Find the child with higher timestamp.
            if (child_idx + 1 < heap_sz) {
                Task *right_child = (*heap)[child_idx + 1];
                if (right_child->enqueue_time_ > child_time) {
                    child_idx += 1;
                    child = right_child;
                    child_time = right_child->enqueue_time_;
                }
            }

            if (child_time <= last_time) break;

            child->heap_idx_ = heap_idx;
            (*heap)[heap_idx] = child;
            heap_idx = child_idx;
        }

        last->heap_idx_ = heap_idx;
        (*heap)[heap_idx] = last;

#ifdef DEBUG_TMGR
        verify_heap(*heap);
#endif
    }

    // For debugging.
    static void verify_heap(const std::vector<Task *> &heap) {
        for (int heap_idx = 0; heap_idx < heap.size(); heap_idx++)
            CHECK(heap[heap_idx]->heap_idx_ == heap_idx);

        for (int heap_idx = 1; heap_idx < heap.size(); heap_idx++) {
            int parent_idx = (heap_idx - 1) / 2;
            Task *t = heap[heap_idx];
            Task *parent = heap[parent_idx];
            CHECK(parent->enqueue_time_ >= t->enqueue_time_);
        }
    }
};

WorkThr::WorkThr(int idx) :
    idx_(idx), tid_(std::this_thread::get_id()), gen_(idx)
{
    my_thr_idx_ = idx;
    util::set_thread_name(util::string_printf("Croquis#%d", idx));
}

void WorkThr::run()
{
    DBG_LOG1(true, "Thread %d started!", idx_);
    while (true) {
        Task *t = tmgr_->dequeue_task(this);
        if (t == nullptr) {
            DBG_LOG1(true, "Thread #%d shutting down ...", idx_);
            return;
        }

        DBG_LOG1(DEBUG_TMGR,
                 "Thr #%d running task [%p] (wait time = %" PRId64 " us) ...",
                 idx_, t, util::microtime() - t->enqueue_time_);
        t->run();

        // Mark task as done.
        Task::Status status = t->status_.exchange(Task::DONE);
        CHECK(status == Task::TMGR_OWNED || status == Task::EXTERNAL_OWNED);

        // Decrements prereq_cnt_ for a dependent task (if any).
        Task *dep = t->dep_;
        if (dep != nullptr) {
            int prereq_cnt = dep->prereq_cnt_.fetch_sub(1) - 1;
            DBG_LOG1(DEBUG_TMGR,
                "Task [%p] was depending on [%p] (remaining count %d)%s ...",
                dep, t, prereq_cnt, (prereq_cnt) ? "" : " - enqueueing");

            if (prereq_cnt == 0) tmgr_->do_enqueue(dep);
        }

        DBG_LOG1(DEBUG_TMGR, "Thr #%d task %p done %s...", idx_, t,
                 status == Task::TMGR_OWNED ? "(deleting) " : "");
        if (status == Task::TMGR_OWNED) delete t;
    }
}

ThrManager::ThrManager(int nthreads, PyCallback_t py_callback,
                       double start_time, int log_fd)
    : nthreads(nthreads), mgr_tid_(std::this_thread::get_id()),
      py_callback_(std::move(py_callback))
{
    // TODO: Would we ever need to re-initialize ThrManager?
    //       ...what if the Python module is reloaded?
    CHECK(tmgr_ == nullptr);
    tmgr_ = this;
    util::init_logging(start_time, log_fd);
}

// Commented out - currently unused.
// TODO: Do we need this?
#if 0
/* static */ void ThrManager::shutdown()
{
    printf("shutdown called, tmgr_ = %p\n", tmgr_);

    if (tmgr_ == nullptr) return;  // Nothing to do.

    // I'll assume that at least `nthreads` and `wthrs_` are properly
    // initialized.
    std::unique_lock<std::mutex> lck(tmgr_->m_);
    tmgr_->shutdown_ = true;
    for (int i = 0; i < tmgr_->nthreads; i++) {
        while (tmgr_->wthrs_.at(i) != nullptr) {
            tmgr_->cv_.notify_all();  // Tell all the threads to shut down.
            tmgr_->shutdown_cv_.wait(lck);
        }
    }

    Task *t = tmgr_->task_queue_;
    while (t != nullptr) {
        Task *next = t->next_;
        delete t;
        t = next;
    }

    printf("ThrManager being deleted %p!\n", tmgr_);
    delete tmgr_;
    tmgr_ = nullptr;
    printf("Done !!!!\n");
}
#endif

void ThrManager::wthr_entry_point(int idx)
{
    DBG_LOG1(DEBUG_TMGR, "%p : wthr_entry_point #%d", this, idx);
    CHECK(idx < nthreads);
    CHECK(std::this_thread::get_id() != mgr_tid_);

    WorkThr *wthr = new WorkThr(idx);
    wthrs_.emplace_back(std::unique_ptr<WorkThr>(wthr));
    wthr->run();

    // If we're here, then ThrManager is shutting down.
    // (Doesn't always happen - happens only when a new ThrManager is being
    // created.)
    {
        std::unique_lock<std::mutex> lck(m_);
        wthrs_.at(idx).reset();
    }

    shutdown_cv_.notify_one();
}

/* static */ void ThrManager::enqueue(std::unique_ptr<Task> task)
{
    task->status_.store(Task::TMGR_OWNED);
    enqueue_no_delete(task.release());
}

/* static */ void ThrManager::enqueue_no_delete(Task *task)
{
    int prereq_cnt = task->prereq_cnt_.fetch_sub(1) - 1;
    CHECK(prereq_cnt >= 0);

    DBG_LOG1(DEBUG_TMGR, "Enqueue requested for task [%p] (%s) (prereq_cnt %d)%s ...",
             task,
             (task->status_.load() == Task::TMGR_OWNED) ? "OWNED" : "NOT OWNED",
             prereq_cnt, (prereq_cnt) ? "" : " - enqueueing");

    if (prereq_cnt == 0) tmgr_->do_enqueue(task);

    // If taskt->prereq_cnt_ > 0, then we still have prerequisite tasks to run:
    // WorkThr::run() will enqueue `task` when its `prereq_cnt_` goes to zero.
}

void ThrManager::do_enqueue(Task *t)
{
    {
        std::unique_lock<std::mutex> lck(m_);

        if (t->sched_class_ == Task::SCHD_FIFO) {
            // Enqueue the task to the FIFO queue.
            ThrHelper::enqueue_task(&fifo_queue_, t);
            fifo_queue_size_++;
        }
        else {
            // Enqueue the task to the low-priority queue.
            ThrHelper::enqueue_task(&low_prio_queue_, t);

            if (t->sched_class_ == Task::SCHD_LIFO)
                ThrHelper::heap_insert_task(&lifo_heap_, t);
            else
                ThrHelper::heap_insert_task(&lifo_low_heap_, t);
        }
    }

    cv_.notify_one();
}

void ThrManager::do_expedite_task(Task *t)
{
    std::unique_lock<std::mutex> lck(m_);

    if (t->heap_idx_ == -1) return;  // Already out of the heap.

    if (t->sched_class_ == Task::SCHD_LIFO)
        ThrHelper::heap_update_task(&lifo_heap_, t, util::microtime());
    else if (t->sched_class_ == Task::SCHD_LIFO_LOW)
        ThrHelper::heap_update_task(&lifo_low_heap_, t, util::microtime());
    else
        DIE_MSG("Invalid task sched_class_!");
}

Task *ThrManager::dequeue_task(WorkThr *wthr)
{
    std::unique_lock<std::mutex> lck(m_);

    while (true) {
        if (shutdown_) return nullptr;

        if (fifo_queue_ != nullptr || low_prio_queue_ != nullptr) break;
        cv_.wait(lck);
    }

    DBG_LOG1(DEBUG_TMGR, "dequeue_task() : queue size = %d %zu %zu",
             fifo_queue_size_, lifo_heap_.size(), lifo_low_heap_.size());

    // 0: dequeue a task from `fifo_queue_` (80%).
    // 1: pop a task from `lifo_heap_`, or `lifo_low_heap_` if the former is
    //    empty (17%).
    // 2: dequeue a task from `low_prio_queue_` (3%).
    int weights[3];

    weights[0] = (fifo_queue_ != nullptr) ? 80 : 0;
    weights[1] = (low_prio_queue_ != nullptr) ? 17 : 0;
    weights[2] = (low_prio_queue_ != nullptr) ? 3 : 0;
    int sum = weights[0] + weights[1] + weights[2];
    CHECK(sum > 0);

    std::uniform_int_distribution<> dist;
    int r = dist(wthr->gen_) % sum;

    if (r < weights[0]) {  // Case #0 (80%).
        DBG_LOG1(DEBUG_TMGR, "Dequeueing from fifo_queue_ ...");
        fifo_queue_size_--;
        return ThrHelper::dequeue_task(&fifo_queue_);
    }
    else if (r < weights[0] + weights[1]) {  // Case #1 (17%).
        Task *t;

        if (!lifo_heap_.empty()) {
            DBG_LOG1(DEBUG_TMGR, "Dequeueing from lifo_heap_ ...");
            t = lifo_heap_[0];
            ThrHelper::heap_remove_task(&lifo_heap_, t);
        }
        else {
            DBG_LOG1(DEBUG_TMGR, "Dequeueing from lifo_low_heap_ ...");
            t = lifo_low_heap_[0];
            ThrHelper::heap_remove_task(&lifo_low_heap_, t);
        }

        // Remove from low_prio_queue_.
        ThrHelper::remove_task(&low_prio_queue_, t);
        return t;
    }
    else { // Case #2 (3%).
        Task *t = ThrHelper::dequeue_task(&low_prio_queue_);

        if (t->sched_class_ == Task::SCHD_LIFO) {
            DBG_LOG1(DEBUG_TMGR,
                     "Dequeueing from low_prio_queue_ (SCHD_LIFO) ...");
            ThrHelper::heap_remove_task(&lifo_heap_, t);
        }
        else if (t->sched_class_ == Task::SCHD_LIFO_LOW) {
            DBG_LOG1(DEBUG_TMGR,
                     "Dequeueing from low_prio_queue_ (SCHD_LIFO_LOW) ...");
            ThrHelper::heap_remove_task(&lifo_low_heap_, t);
        }
        else
            DIE_MSG("Invalid sched_class_ !!");

        return t;
    }
}

bool ThrManager::send_msg(uintptr_t obj_id,
                          const std::vector<std::string> &dict,
                          std::unique_ptr<croquis::MessageData> data1,
                          std::unique_ptr<croquis::MessageData> data2)
{
    py::gil_scoped_acquire lck;
    // Seems like this will transfer ownership to Python.
    return py_callback_(obj_id, dict, std::move(data1), std::move(data2));
}

}  // namespace croquis
