/* Copyright (c) 2013-2020 Jeffrey Pfau
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include <3ds/archive.h>

#include <mgba-util/common.h>
#include <mgba-util/platform/3ds/rom-buffer.h>

uint32_t* romBuffer = NULL;
size_t romBufferSize;

// Keep GPU/audio storage separate while leaving room for 64MiB ROM + extra RAM.
u32 __ctru_linear_heap_size = 4 * 1024 * 1024;

extern u32 __ctru_heap_size;
static char romLoadError[160];

const char* m3DSROMError(void) {
	return romLoadError;
}

void m3DSSetROMError(const char* error) {
	snprintf(romLoadError, sizeof(romLoadError), "%s", error);
}

FS_Archive sdmcArchive;

void userAppInit(void) {
	FSUSER_OpenArchive(&sdmcArchive, ARCHIVE_SDMC, fsMakePath(PATH_EMPTY, ""));

}

bool m3DSResizeROMBuffer(size_t size) {
	if (!size || size > 0x04000000) {
		return false;
	}
	if (romBuffer && romBufferSize == size) {
		return true;
	}
	// The previous game has been unloaded. Avoid holding both a 32MiB and a
	// 64MiB allocation while loading a large ROM on New 3DS.
	free(romBuffer);
	romBuffer = NULL;
	romBufferSize = 0;
	romBuffer = malloc(size);
	if (!romBuffer) {
		snprintf(romLoadError, sizeof(romLoadError), "No RAM: ROM %uM / heap %uM.", (unsigned) (size >> 20), (unsigned) (__ctru_heap_size >> 20));
		return false;
	}
	romBufferSize = size;
	return true;
}
