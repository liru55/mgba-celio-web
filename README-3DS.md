# Celio native 3DS build

This branch builds the existing native 3DS frontend, separately from the Web UI.

- GBA ROM: up to 64 MiB. The second 32 MiB uses the Celio core's extended ROM mapping.
- Flash saves: up to 1 MiB (16 banks of 64 KiB), using the shared Celio save implementation. Existing 128 KiB saves remain supported; extension occurs when the game selects a higher bank. Existing 1 MiB saves are detected on load.
- 1 MiB here means 1,048,576 bytes, not the traditional FLASH1M cartridge type (1 megabit / 128 KiB).
- 64 MiB ROMs require New Nintendo 3DS / New 2DS and an environment that grants sufficient application memory. The CIA requests 96 MiB on Old 3DS and 178 MiB on New 3DS. A 3DSX launcher may grant less memory; use the CIA if ROM loading fails.
- Old 3DS remains usable for smaller ROMs, subject to the core's memory requirements. The extended-memory CIA attempts 64 MiB loading, but available memory and playback speed still need real-device verification.

The native ROM loader owns one resizable buffer and reads SD data directly into it, rather than reserving 32 MiB and separately mapping the ROM. GPU/audio linear heap is limited to 4 MiB so more memory remains for ROM, extra RAM and saves. Allocation or short-read errors reject loading.

Build with devkitPro (devkitARM, libctru, citro3d and 3DS tools):

```sh
cmake -S . -B build-3ds \
  -DCMAKE_TOOLCHAIN_FILE=src/platform/3ds/CMakeToolchain.txt \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_QT=OFF -DBUILD_SDL=OFF -DUSE_LTO=OFF
cmake --build build-3ds --parallel 2
```

The Native 3DS GitHub Actions workflow produces `.3dsx`, `.cia` and `.smdh` artifacts. ROMs and saves are not included. Real hardware compatibility and performance still require testing on the target device.
