// Messages between frontend and backend.

#pragma once

#include <stdio.h>

#include <memory>  // unique_ptr
#include <string>

namespace croquis {

#if 0
// A simple buffer that uses shared_ptr implementation.
struct SharedBuf {
    // Unfortunately, shared_ptr of an array requires C++17, so let's use a
    // wrapper.
    std::unique_ptr<char[]> ptr;
    size_t sz;
};
#endif

// Manages binary data buffer used to send data back to frontend.
class MessageData {
  public:
    const std::string name;  // For debugging.

  protected:
    const size_t size_;

    MessageData(const std::string &name, size_t sz) : name(name), size_(sz) { }

  public:
    virtual ~MessageData() { }

    virtual void *get() = 0;
    const void *get() const { return const_cast<MessageData *>(this)->get(); }
    size_t size() const { return size_; }
};

// Simplest implementation using unique_ptr.
class UniqueMessageData final : public MessageData {
  private:
    std::unique_ptr<char[]> ptr;

  public:
    UniqueMessageData(const std::string &name, size_t sz)
        : MessageData(name, sz), ptr(std::make_unique<char[]>(sz)) { }

    virtual void *get() override { return (void *) ptr.get(); }
};

}  // namespace croquis
