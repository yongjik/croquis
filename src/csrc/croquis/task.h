// A unit of work that can run in any worker thread.

#pragma once

#include <stdint.h>  // int64_t

#include <atomic>
#include <memory>  // unique_ptr

#include "croquis/util/clock.h"  // microtime
#include "croquis/util/macros.h"  // CHECK

namespace croquis {

class ThrManager;
class WorkThr;

// Forward declaration.
class Task;

// TODO: The task object is destroyed in the worker thread, which is most likely
// a different thread than the one that created it.  It might increase CPU
// overhead.  Maybe we could use a task object pool...?
class Task {
  public:
    // Currently we support three scheduling classes for Tasks.
    //
    // - SCHD_FIFO is regular tasks (highest priority), served FIFO.
    //
    // - SCHD_LIFO is used for tiles, served *LIFO*, because more recent tile
    //   requests are usually more relevant.
    //
    // - SCHD_LIFO_LOW is similar to SCHD_LIFO but has lower priority: they are
    //   used for low-priority highlight tiles.
    //
    // Tasks using SCHD_LIFO/SCHD_LIFO_LOW can be "expedited" by calling
    // ThrManager::expedite_task() - we then update `enqueue_time_` to the
    // current time, so that it has the highest priority.
    //
    // To avoid starvation, we reserve some scheduling slot for executing tasks
    // in SCHD_LIFO/SCHD_LIFO_LOW in FIFO order.  These tasks should check
    // how long they stayed in the queue and abort if they are "stale".
    enum ScheduleClass {
        SCHD_FIFO = 0,
        SCHD_LIFO = 1,
        SCHD_LIFO_LOW = 2,
    };

    // Determines whether the task is "owned" by ThrManager.
    //
    // A task owned by ThrManager (TMGR_OWNED) is deleted upon completion.
    //
    // An externally owned task (EXTERNAL_OWNED) is *not* automatically deleted
    // upon completion: the caller that created this task should own the
    // pointer.  This is the expected behavior for tasks using
    // SCHD_LIFO/SCHD_LIFO_LOW, so that they can be "expedited" while in the
    // queue: otherwise there will be a race condition between
    // ThrManager::expedite_task() and ThrManager actually running the task and
    // deleting it.
    //
    // An EXTERNAL_OWNED task may transition to TMGR_OWNED if the owner
    // relinquishes ownership, or DONE if it is finished.
    enum Status : int {
        TMGR_OWNED = 0,
        EXTERNAL_OWNED = 1,
        DONE = 2,
    };

  private:
    friend class WorkThr;
    friend class ThrManager;
    friend class ThrHelper;

    const ScheduleClass sched_class_;

    // Time when this task is enqueued: used for SCHD_LIFO and SCHD_LIFO_LOW.
    int64_t enqueue_time_;

    // Pointers to construct task queues and priority queues: managed by WorkThr
    // and ThrManager.
    Task *next_ = nullptr;
    Task *prev_ = nullptr;
    int heap_idx_ = -1;

    // Prerequisite count: counts the number of unfinished tasks that are its
    // own prerequisites.  If this becomes zero, we can start.
    //
    // Accessed via ThrManager.
    //
    // We actually start with count 1, which is later decremented by
    // ThrManager::enqueue().  This way, a Task cannot prematurely start before
    // it is officially enqueued.
    std::atomic<int> prereq_cnt_{1};

    std::atomic<Status> status_{EXTERNAL_OWNED};

    // Dependent task: an optional task for which this task is a prerequisite.
    Task *dep_;

  protected:
    // Specify that this is a prerequiste task of another task `dep`.
    // `dep` must not have been enqueued yet.
    explicit Task(ScheduleClass sched_class = SCHD_FIFO, Task *dep = nullptr)
        : sched_class_(sched_class), enqueue_time_(util::microtime()), dep_(dep)
    {
        if (dep != nullptr) dep->prereq_cnt_.fetch_add(1);
    }

  public:
    virtual ~Task() { }
    virtual void run() = 0;

    // Safely relinquish ownership of a task that may or may not be finished
    // yet.
    static void relinquish_ownership(std::unique_ptr<Task> task) {
        Status s = EXTERNAL_OWNED;

        // If CAS succeeds, then the thread is now owned by ThrManager: it will
        // be freed when it is complete.
        //
        // If it fails, then the thread must be already complete (DONE), so we
        // should free it here.
        if (task->status_.compare_exchange_strong(s, TMGR_OWNED))
            task.release();
        else {
            CHECK(s == DONE);
            task.reset();
        }
    }

    DISALLOW_COPY_AND_MOVE(Task);
};

// A simple task to run a function.
template<typename T> class LambdaTask : public Task {
  private:
    T fn_;

  public:
    explicit LambdaTask(T &&fn,
                        ScheduleClass sched_class = SCHD_FIFO,
                        Task *dep = nullptr)
        : Task(sched_class, dep), fn_(std::move(fn)) { }

  public:
    virtual void run() override { fn_(); }
};

template<typename T> std::unique_ptr<LambdaTask<T>>
make_lambda_task(T &&fn,
                 Task::ScheduleClass sched_class = Task::SCHD_FIFO,
                 Task *dep = nullptr)
{
    return std::make_unique<LambdaTask<T>>(std::move(fn), sched_class, dep);
}

}  // namespace croquis
