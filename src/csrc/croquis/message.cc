// Messages between frontend and backend.

#include "croquis/message.h"

#include <stdio.h>

#include "croquis/thr_manager.h"

namespace croquis {

#if 0
// Called when Python code is done with this data - we call the "unpin task".
MessageData::~MessageData()
{
    if (unpin_task_ != nullptr) ThrManager::enqueue(std::move(unpin_task_));

    // printf("MessageData freed: %p\n", this);
}
#endif

}  // namespace croquis
