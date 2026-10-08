/* Mozilla Public License 2.0; see ../LICENSE. */
(async () => {
  const $ = id => document.getElementById(id), status = $('status');
  let m;
  try { m = await createMGBA(); } catch (e) { status.textContent = `読み込み失敗: ${e.message}`; return; }
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  let loaded = false, paused = false, keys = 0, image, name = 'game', clock = 0, nextAudio = 0, audioContext;
  const held = new Set(), touches = new Map();
  const mapping = {KeyZ:0,KeyX:1,ShiftLeft:2,ShiftRight:2,Enter:3,ArrowRight:4,ArrowLeft:5,ArrowUp:6,ArrowDown:7,KeyS:8,KeyA:9};
  function updateKeys() { keys = 0; for (const code of held) keys |= 1 << mapping[code]; for (const bit of touches.values()) keys |= 1 << bit; }
  function release() { document.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); held.clear(); touches.clear(); updateKeys(); clock = 0; nextAudio = 0; }
  async function enableAudio() {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
  }
  function upload(bytes, call) {
    const p = m._malloc(bytes.length);
    if (!p) throw new Error('メモリが足りません');
    try { m.HEAPU8.set(bytes, p); return call(p, bytes.length); } finally { m._free(p); }
  }
  function togglePause() {
    if (!loaded) return;
    paused = !paused; release();
    $('pause').textContent = paused ? '再開' : '一時停止';
    status.textContent = paused ? '一時停止中' : name;
    if (!paused) enableAudio().catch(() => {});
  }
  $('open').disabled = false; status.textContent = 'ROMを選んで開始してください';
  $('open').onclick = () => { enableAudio().catch(() => {}); $('rom').click(); };
  $('rom').onchange = async () => {
    const file = $('rom').files[0]; if (!file) return;
    paused = true; release();
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('ROMは64MB以下を選んでください');
      loaded = !!upload(new Uint8Array(await file.arrayBuffer()), (p,n) => m._web_load(p,n));
      if (!loaded) throw new Error('対応するGBA / GB / GBC ROMを選んでください');
      name = file.name; canvas.width = m._web_width(); canvas.height = m._web_height();
      canvas.style.aspectRatio = `${canvas.width}/${canvas.height}`;
      image = ctx.createImageData(canvas.width, canvas.height);
      paused = false; $('pause').textContent = '一時停止'; status.textContent = name;
    } catch (e) { status.textContent = e.message; }
    for (const id of ['pause','reset','export','import']) $(id).disabled = !loaded;
    $('rom').value = '';
  };
  $('pause').onclick = togglePause;
  $('reset').onclick = () => { if (loaded) { m._web_reset(); release(); } };
  $('export').onclick = () => {
    if (!loaded) return;
    const n = m._web_save_export();
    if (!n) { status.textContent = 'セーブデータがまだありません'; return; }
    const blob = new Blob([m.HEAPU8.slice(m._web_save_data(), m._web_save_data() + n)], {type:'application/octet-stream'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name.replace(/\.[^.]+$/, '') + '.sav'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  $('import').onclick = () => { if (loaded) $('save').click(); };
  $('save').onchange = async () => {
    const file = $('save').files[0]; if (!file || !loaded) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('セーブファイルが大きすぎます');
      if (!upload(new Uint8Array(await file.arrayBuffer()), (p,n) => m._web_save_import(p,n))) throw new Error('セーブを読み込めませんでした');
      m._web_reset(); release(); status.textContent = 'セーブを読み込みました';
    } catch (e) { status.textContent = e.message; }
    $('save').value = '';
  };
  $('fullscreen').onclick = () => {
    if (canvas.requestFullscreen) canvas.requestFullscreen().catch(() => {});
    else { document.body.classList.toggle('expanded'); status.textContent = '全画面起動はSafariの共有メニューから「ホーム画面に追加」'; }
  };
  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    let action;
    if (mod && e.code === 'KeyO') action = e.shiftKey ? 'import' : 'open';
    else if (mod && e.code === 'KeyS') action = 'export';
    else if (mod && e.code === 'KeyR') action = 'reset';
    else if (!mod && e.code === 'Space') action = 'pause';
    else if (!mod && e.code === 'KeyF') action = 'fullscreen';
    if (action) { e.preventDefault(); if (!e.repeat) $(action).click(); return; }
    if (!mod && mapping[e.code] !== undefined) { e.preventDefault(); held.add(e.code); updateKeys(); }
  });
  addEventListener('keyup', e => { if (mapping[e.code] !== undefined) { e.preventDefault(); held.delete(e.code); updateKeys(); } });
  addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { release(); if (document.hidden && loaded && !paused) togglePause(); });
  for (const b of document.querySelectorAll('[data-key]')) {
    b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('pressed'); touches.set(e.pointerId, +b.dataset.key); updateKeys(); enableAudio().catch(() => {}); };
    const end = e => { b.classList.remove('pressed'); touches.delete(e.pointerId); updateKeys(); };
    b.onpointerup = end; b.onpointercancel = end; b.onlostpointercapture = end;
  }
  const play = document.querySelector('.play');
  const groups = ['dpad','ab','shoulders','system'];
  let layout = {overlay:true,scale:.75,opacity:.55,positions:{}}, editing = false, drag;
  try { const saved = JSON.parse(localStorage.getItem('mgba-touch-layout')); if (saved) layout = {...layout,...saved}; } catch (_) {}
  function applyLayout() {
    play.classList.toggle('overlay', layout.overlay);
    play.classList.toggle('editing', editing);
    play.style.setProperty('--pad-scale', layout.scale);
    play.style.setProperty('--pad-opacity', layout.opacity);
    $('overlay').checked = layout.overlay;
    $('pad-scale').value = layout.scale; $('pad-opacity').value = layout.opacity;
    $('pad-edit').disabled = !layout.overlay;
    $('pad-edit').textContent = editing ? '位置調整を終える' : '位置を調整';
    for (const group of groups) {
      const el = play.querySelector('.'+group), pos = layout.positions[group];
      el.style.left = layout.overlay && pos ? pos.x+'%' : '';
      el.style.top = layout.overlay && pos ? pos.y+'%' : '';
    }
  }
  function storeLayout() { try { localStorage.setItem('mgba-touch-layout',JSON.stringify(layout)); } catch (_) {} }
  $('overlay').onchange = () => { layout.overlay = $('overlay').checked; editing = false; release(); applyLayout(); storeLayout(); };
  for (const [id,key] of [['pad-scale','scale'],['pad-opacity','opacity']]) $(id).oninput = () => { layout[key] = +$(id).value; applyLayout(); storeLayout(); };
  $('pad-edit').onclick = () => { editing = !editing; release(); if (editing && loaded && !paused) togglePause(); applyLayout(); if (editing) play.scrollIntoView({block:'center'}); };
  $('pad-default').onclick = () => { layout = {overlay:true,scale:.75,opacity:.55,positions:{}}; editing = false; release(); applyLayout(); storeLayout(); };
  for (const group of groups) {
    const el = play.querySelector('.'+group);
    el.addEventListener('pointerdown', e => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation(); release();
      const rect = play.getBoundingClientRect(), bounds = el.getBoundingClientRect();
      drag = {id:e.pointerId,group,dx:e.clientX-(bounds.left+bounds.width/2),dy:e.clientY-(bounds.top+bounds.height/2)};
      el.setPointerCapture(e.pointerId);
    },true);
    el.addEventListener('pointermove', e => {
      if (!editing || !drag || drag.id !== e.pointerId || drag.group !== group) return;
      e.preventDefault(); e.stopPropagation();
      const rect = play.getBoundingClientRect();
      layout.positions[group] = {x:Math.max(5,Math.min(95,100*(e.clientX-rect.left-drag.dx)/rect.width)),y:Math.max(5,Math.min(95,100*(e.clientY-rect.top-drag.dy)/rect.height))};
      applyLayout();
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) el.addEventListener(type,e => { if (drag && drag.id === e.pointerId) { drag = null; storeLayout(); } });
  }
  applyLayout();
  function playAudio() {
    const n = m._web_audio_read();
    if (!n || !audioContext || audioContext.state !== 'running') return;
    const rate = m._web_audio_rate(), p = m._web_audio() >> 1;
    if (nextAudio > audioContext.currentTime + .2) return;
    const outputRate = audioContext.sampleRate, count = Math.max(1, Math.round(n * outputRate / rate));
    const buffer = audioContext.createBuffer(2, count, outputRate);
    for (let c = 0; c < 2; ++c) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < count; ++i) {
        const position = i * rate / outputRate, j = Math.min(n-1, Math.floor(position)), t = position-j;
        channel[i] = ((1-t)*m.HEAP16[p+j*2+c] + t*m.HEAP16[p+Math.min(j+1,n-1)*2+c]) / 32768;
      }
    }
    const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination);
    nextAudio = Math.max(nextAudio, audioContext.currentTime + .025); source.start(nextAudio); nextAudio += count/outputRate;
  }
  function tick(now) {
    if (loaded && !paused) {
      const step = 1000/m._web_fps(); if (!clock) clock = now;
      let frames = 0;
      while (now >= clock && frames++ < 4) { m._web_frame(keys); playAudio(); clock += step; }
      if (now-clock > step*4) clock = now;
      const p = m._web_pixels();
      for (let y=0; y<canvas.height; ++y) image.data.set(m.HEAPU8.subarray(p+y*256*4, p+y*256*4+canvas.width*4), y*canvas.width*4);
      for (let i=3; i<image.data.length; i+=4) image.data[i] = 255;
      ctx.putImageData(image,0,0);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
