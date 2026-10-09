# CPU and background-rendering optimization (2026-10-09)

This change optimizes two shared GBA-core hot paths. It preserves instruction behavior, emulation cycles, bus wait states, ROM mapping, save formats, and communication logic.

- ARM addition/subtraction flag helpers calculate NZCV and update the flags byte once, instead of clearing it and updating four bitfields separately. Other CPSR bytes retain their previous values.
- Mode 0 background tile-map caching selects the horizontal screen block once and reads two contiguous VRAM rows in a 32-iteration loop. The same endian-aware load macros remain in use.

The general RAM/ROM/IO read/write handlers and CPU dispatch loop are unchanged. Broad LTO, forced inlining, and bulk-copy candidates did not produce a consistent whole-emulator improvement and were excluded. Native 3DS binaries were not rebuilt or tested.

## Measurements

Isolated WASM tests on this development machine:

| Hot path | Before (median) | After (median) |
| --- | --- | --- |
| 20 million ARM flag-helper calls | 153.689 ms | 74.823 ms |
| 1 million tile-map row fills | 27.662 ms | 5.855 ms |

These are approximately 51% and 79% reductions in the respective microbenchmarks, not overall emulator speed increases. After warm-up, the supplied ROM's complete frame-processing time was approximately unchanged in Chromium and WebKit (variation around 1%). No substantial overall FPS gain is claimed.

## Verification

- 2,000,250 comparisons of the actual old/new ARM flag helpers, including random inputs, integer boundaries, and full CPSR preservation.
- 65,536 tile-map row comparisons across all screen block bases, background sizes, and vertical positions.
- GB/GBA 300-frame pixel, audio, and state hashes match the preceding build with the test RTC clock fixed.
- Chromium and WebKit long runs and repeated state loads: core state hashes match the preceding build.
- Portrait, landscape, desktop, save import/browser storage, quick save/load, screenshots, offline reload, and local Celio start/view/disconnect remain functional.
- Speed scheduling and unmuted gain tested at 1x, 1.5x, 2x, 3x, and 4x. 128 KiB, 1 MiB, and 6 MiB save import/export also checked.

Private ROM/save fixtures are not included. Actual in-game trading and physical phone/3DS hardware were not tested.
