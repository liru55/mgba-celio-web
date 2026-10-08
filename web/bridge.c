/* Mozilla Public License 2.0; see ../LICENSE. */
#include <emscripten/emscripten.h>
#include <mgba/core/core.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/image.h>
#include <mgba-util/vfs.h>

static struct mCore* core;
static mColor pixels[256 * 224];
static int16_t audio[4096 * 2];
static void* rom;
static void* save;
static unsigned width, height;

EMSCRIPTEN_KEEPALIVE void web_close(void) {
  if (core) {
    mCoreConfigDeinit(&core->config);
    core->deinit(core);
    core = NULL;
  }
  free(rom); rom = NULL;
  free(save); save = NULL;
}

EMSCRIPTEN_KEEPALIVE int web_load(const void* data, size_t size) {
  if (!data || !size || size > 64 * 1024 * 1024) return 0;
  web_close();
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
