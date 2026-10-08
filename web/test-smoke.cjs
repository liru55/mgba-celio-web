const assert = require('node:assert/strict');
const create = require(require('node:path').resolve(__dirname, '../build-web/mgba.js'));
(async () => {
  const m = await create();
  function load(bytes) { const p=m._malloc(bytes.length); m.HEAPU8.set(bytes,p); const ok=m._web_load(p,bytes.length); m._free(p); return ok; }
  assert.equal(load(new Uint8Array(512)),0);
  for (const kind of ['gba','gb','gbc','gba']) {
    const rom=new Uint8Array(32768);
    if (kind==='gba') { rom.set([0xfe,0xff,0xff,0xea]); rom[0xb2]=0x96; }
    else { rom.set([0xc3,0x50,0x01],0x100); rom.set([0xce,0xed,0x66,0x66],0x104); rom.set([0x18,0xfe],0x150); rom[0x147]=3; rom[0x149]=2; if(kind==='gbc') rom[0x143]=0x80; }
    assert.equal(load(rom),1);
    assert.equal(m._web_width(),kind==='gba'?240:160);
    assert.equal(m._web_height(),kind==='gba'?160:144);
    for(let i=0;i<60;i++) { m._web_frame(i===1?1:0); assert.ok(m._web_audio_read()>0); }
    assert.ok(m._web_fps()>59 && m._web_fps()<61);
    const n=m._web_save_export();
    if(kind!=='gba') { assert.ok(n>0); assert.equal(m._web_save_import(m._web_save_data(),n),1); }
    m._web_reset(); m._web_frame(0);
    console.log(kind, '60 frames, audio, reset, save:', n, 'PASS');
  }
  m._web_close(); m._web_close();
})().catch(e=>{console.error(e);process.exitCode=1;});

