/* Mozilla Public License 2.0; see ../LICENSE. */
#include <emscripten/emscripten.h>
#include <mgba/core/core.h>
#include <mgba/core/cheats.h>
#include <mgba/core/serialize.h>
#include <mgba/internal/gba/gba.h>
void celio_stop(unsigned slot);
int celio_start(unsigned slot, struct mCore* core);
#include <mgba-util/audio-buffer.h>
#include <mgba-util/image.h>
#include <mgba-util/vfs.h>

struct WebSlot {
  struct mCore* machine;
  mColor video[256 * 224];
  int16_t sound[4096 * 2];
  void *romBytes, *savedata, *snapshot;
  unsigned videoWidth, videoHeight;
};
static struct WebSlot slots[2];
static unsigned selected;
static void quietLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) { (void)logger; (void)category; (void)level; (void)format; (void)args; }
static struct mLogger quietLogger = {.log = quietLog};
#define core slots[selected].machine
#define pixels slots[selected].video
#define audio slots[selected].sound
#define rom slots[selected].romBytes
#define save slots[selected].savedata
#define state slots[selected].snapshot
#define width slots[selected].videoWidth
#define height slots[selected].videoHeight

EMSCRIPTEN_KEEPALIVE unsigned web_selected(void) { return selected; }
EMSCRIPTEN_KEEPALIVE int web_select(unsigned index) { if (index > 1) return 0; selected = index; return 1; }
EMSCRIPTEN_KEEPALIVE int web_celio_start(unsigned slot) { return slot<2 ? celio_start(slot,slots[slot].machine) : 0; }
EMSCRIPTEN_KEEPALIVE void web_celio_stop(unsigned slot) { celio_stop(slot); }
EMSCRIPTEN_KEEPALIVE unsigned web_memory_read8(uint32_t address) { return core ? core->rawRead8(core,address,-1) : 0; }
EMSCRIPTEN_KEEPALIVE unsigned web_bus_read16(uint32_t address) { return core ? core->busRead16(core,address) : 0; }
EMSCRIPTEN_KEEPALIVE void web_bus_write16(uint32_t address,uint16_t value) { if (core) core->busWrite16(core,address,value); }

EMSCRIPTEN_KEEPALIVE void web_close(void) {
  celio_stop(selected);
  if (core) {
    mCoreConfigDeinit(&core->config);
    core->deinit(core);
    core = NULL;
  }
  free(rom); rom = NULL;
  free(save); save = NULL;
  free(state); state = NULL;
}

EMSCRIPTEN_KEEPALIVE int web_load(const void* data, size_t size) {
  if (!data || !size || size > 64 * 1024 * 1024) return 0;
  web_close();
  mLogSetDefaultLogger(&quietLogger);
  rom = malloc(size);
  if (!rom) return 0;
  memcpy(rom, data, size);
  struct VFile* vf = VFileFromMemory(rom, size);
  if (!vf) { web_close(); return 0; }
  core = mCoreFindVF(vf);
  if (!core) { vf->close(vf); web_close(); return 0; }
  if (!core->init(core)) { free(core); core = NULL; vf->close(vf); web_close(); return 0; }
  mCoreInitConfig(core, "web");
  core->opts.volume = 256;
  core->opts.useBios = false;
  core->opts.skipBios = true;
  core->loadConfig(core, &core->config);
  core->setVideoBuffer(core, pixels, 256);
  core->setAudioBufferSize(core, 4096);
  if (!core->loadROM(core, vf)) { vf->close(vf); web_close(); return 0; }
  core->reset(core);
  core->currentVideoSize(core, &width, &height);
  return 1;
}
EMSCRIPTEN_KEEPALIVE unsigned web_width(void) { return width; }
EMSCRIPTEN_KEEPALIVE unsigned web_height(void) { return height; }
EMSCRIPTEN_KEEPALIVE void* web_pixels(void) { return pixels; }
/* Pack the renderer's padded RGB rows for Canvas without changing core pixels. */
EMSCRIPTEN_KEEPALIVE void* web_rgba_pixels(void) {
  static uint32_t rgba[256 * 224];
  for (unsigned y = 0; y < height; ++y) {
    for (unsigned x = 0; x < width; ++x) {
      rgba[y * width + x] = pixels[y * 256 + x] | 0xFF000000u;
    }
  }
  return rgba;
}
EMSCRIPTEN_KEEPALIVE void web_frame(unsigned keys) {
  if (!core) return;
  core->setKeys(core, keys);
  core->runFrame(core);
}
EMSCRIPTEN_KEEPALIVE void web_reset(void) { if (core) core->reset(core); }
EMSCRIPTEN_KEEPALIVE double web_fps(void) { return core ? (double) core->frequency(core) / core->frameCycles(core) : 60; }
EMSCRIPTEN_KEEPALIVE unsigned web_audio_rate(void) { return core ? core->audioSampleRate(core) : 32768; }
EMSCRIPTEN_KEEPALIVE void* web_audio(void) { return audio; }
EMSCRIPTEN_KEEPALIVE size_t web_audio_read(void) { return core ? mAudioBufferRead(core->getAudioBuffer(core), audio, 4096) : 0; }
EMSCRIPTEN_KEEPALIVE size_t web_save_export(void) {
  free(save); save = NULL;
  return core ? core->savedataClone(core, &save) : 0;
}
EMSCRIPTEN_KEEPALIVE void* web_save_data(void) { return save; }
EMSCRIPTEN_KEEPALIVE int web_save_import(const void* data, size_t size) { return core && core->savedataRestore(core, data, size, false); }

/* Sets belong to the core and are discarded when another ROM is loaded. */
EMSCRIPTEN_KEEPALIVE int web_platform(void) { return core ? core->platform(core) : -1; }
EMSCRIPTEN_KEEPALIVE int web_cheat_add(const char* name, const char* codes, int type) {
  if (!core || !codes || !*codes || strlen(codes) > 16384) return -1000;
  struct mCheatDevice* device = core->cheatDevice(core);
  if (!device || mCheatSetsSize(&device->cheats) >= 100) return -1000;
  struct mCheatSet* set = device->createSet(device, name);
  char* text = strdup(codes);
  if (!set || !text) { if (set) mCheatSetDeinit(set); free(text); return -1000; }
  char* line = text;
  int number = 0, count = 0;
  while (line) {
    ++number;
    char* next = strchr(line, '\n');
    if (next) *next++ = 0;
    while (*line && isspace((unsigned char)*line)) ++line;
    size_t length = strlen(line);
    while (length && isspace((unsigned char)line[length - 1])) line[--length] = 0;
    if (length) {
      if (!mCheatAddLine(set, line, type)) { free(text); mCheatSetDeinit(set); return -number; }
      ++count;
    }
    line = next;
  }
  free(text);
  if (!count) { mCheatSetDeinit(set); return -1000; }
  mCheatAddSet(device, set);
  mCheatRefresh(device, set);
  return (int)mCheatSetsSize(&device->cheats) - 1;
}
EMSCRIPTEN_KEEPALIVE int web_cheat_enable(unsigned index, int enabled) {
  if (!core) return 0;
  struct mCheatDevice* device = core->cheatDevice(core);
  if (!device || index >= mCheatSetsSize(&device->cheats)) return 0;
  struct mCheatSet* set = *mCheatSetsGetPointer(&device->cheats, index);
  set->enabled = !!enabled;
  mCheatRefresh(device, set);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int web_cheat_remove(unsigned index) {
  if (!core) return 0;
  struct mCheatDevice* device = core->cheatDevice(core);
  if (!device || index >= mCheatSetsSize(&device->cheats)) return 0;
  struct mCheatSet* set = *mCheatSetsGetPointer(&device->cheats, index);
  set->enabled = false;
  mCheatRefresh(device, set);
  mCheatRemoveSet(device, set);
  mCheatSetDeinit(set);
  return 1;
}

/* A complete quick state, including save RAM and RTC, stays on this device. */
EMSCRIPTEN_KEEPALIVE size_t web_state_export(void) {
  free(state); state = NULL;
  if (!core) return 0;
  struct VFile* vf = VFileMemChunk(NULL, 0);
  if (!vf) return 0;
  if (!mCoreSaveStateNamed(core, vf, SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_SCREENSHOT)) { vf->close(vf); return 0; }
  ssize_t size = vf->size(vf);
  if (size <= 0 || size > 16 * 1024 * 1024) { vf->close(vf); return 0; }
  state = malloc(size);
  if (!state) { vf->close(vf); return 0; }
  vf->seek(vf, 0, SEEK_SET);
  bool ok = vf->read(vf, state, size) == size;
  vf->close(vf);
  if (!ok) { free(state); state = NULL; return 0; }
  return size;
}
EMSCRIPTEN_KEEPALIVE void* web_state_data(void) { return state; }
EMSCRIPTEN_KEEPALIVE int web_state_import(const void* data, size_t size) {
  if (!core || !data || size < core->stateSize(core) || size > 16 * 1024 * 1024) return 0;
  struct VFile* vf = VFileFromConstMemory(data, size);
  if (!vf) return 0;
  /* These cores have no save-file backing to write into. Restore the state's
     private save mask, including saves whose hardware type is not detected yet. */
  bool ok = mCoreLoadStateNamed(core, vf, SAVESTATE_RTC | SAVESTATE_SCREENSHOT);
  vf->close(vf);
  return ok;
}

EMSCRIPTEN_KEEPALIVE uint32_t web_state_hash(void) {
  if (!core) return 0;
  size_t size = core->stateSize(core);
  unsigned char* data = calloc(1,size);
  if (!data || !core->saveState(core,data)) { free(data); return 0; }
  uint32_t hash = 2166136261u;
  for (size_t i=0;i<size;++i) hash = (hash ^ data[i]) * 16777619u;
  free(data); return hash;
}
