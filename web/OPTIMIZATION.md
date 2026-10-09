# 2026-10-09 optimization notes

Scope: Web pixel transfer, Web stereo interpolation, and shared audio-buffer/resampler utilities. CPU instruction execution, emulation timing, memory mapping, saves, and Celio communication logic are unchanged. Native 3DS packaging and its startup issue remain outside this change.

## Changes

- Cache invariant resampler bounds, retaining dynamic checks when buffers alias.
- Read contiguous aligned audio samples directly, retaining the existing generic path for unusual byte boundaries.
- Calculate stereo interpolation positions once for both channels.
- Add an opaque packed RGBA transfer path. A short calibration on ROM load selects it only when it is at least 10% faster than the existing cached-row path. Older cached cores retain the row path.
- Update the PWA asset cache to v37.

The RGBA scratch buffer adds 224 KiB to WASM memory. Calibration copies pixels without advancing emulation and adds a small startup cost.

## Measurements

These are isolated processing measurements, not overall emulator speed claims. Results depend on the device and browser.

| Processing | Result |
| --- | --- |
| Shared sinc resampling, median of 3 runs | About 31% less processing time |
| Pixel transfer, Chromium | About 37% less processing time |
| Pixel transfer, WebKit | Packed path was slower; calibration selects existing rows |
| Web stereo interpolation, Chromium / WebKit | About 21% / 39% less processing time |

## Verification

- Shared resampler: 136 cases, including aliased buffers, identical output hash.
- Audio peek: 17,850 comparisons, including wrapped and odd byte positions.
- Web stereo conversion: 300 conditions with identical sample bytes and scheduling.
- GB and 64 MiB GBA: 300 frames each, matching published-baseline pixel, audio, and save-state hashes.
- Chromium and WebKit: portrait, landscape, desktop; exact Canvas pixels; save import, browser storage, quick save/load, screenshot, and offline reload under simulated network failure.
- Local Celio: start, view switch, and disconnect. Actual in-game trading and physical iPhone/3DS hardware were not tested.
- Speed and unmuted output: 1x, 1.5x, 2x, 3x, and 4x.

Private ROM and save fixtures are not included in the repository or published assets.
