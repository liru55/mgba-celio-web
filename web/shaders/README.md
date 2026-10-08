# xBRZ Freescale Multipass

Unmodified shader sources from libretro/glsl-shaders, commit 435612fe4f1023117b3aae48c88603fb413404a3.
https://github.com/libretro/glsl-shaders/tree/435612fe4f1023117b3aae48c88603fb413404a3/xbrz/shaders/xbrz-freescale-multipass

Hyllian / Zenju notices are retained in both files. The sources include MIT-style permission and GPL-3.0 code/concepts; GPL-3.0 text is in COPYING.txt. The WebGL driver selects the fragment branch of each original source and supplies RetroArch-compatible uniforms. Pass 0 uses an RGBA8 framebuffer at the original ROM resolution; pass 1 scales to the viewport and also samples the original image. The original algorithms are unchanged. Full shader and driver source is distributed at https://github.com/liru55/mgba-celio-web/tree/main/web .
