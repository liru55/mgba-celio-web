/* MPL-2.0. ROM storage owned by the 3DS frontend. */
#ifndef M_3DS_ROM_BUFFER_H
#define M_3DS_ROM_BUFFER_H
#include <mgba-util/common.h>
CXX_GUARD_START
// Call only after unloading the previous ROM. Failed allocations clear storage.
bool m3DSResizeROMBuffer(size_t size);
CXX_GUARD_END
#endif
