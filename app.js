/* Mozilla Public License 2.0; see ../LICENSE. */
(async () => {
  const $ = id => document.getElementById(id), status = $('status');
  let m;
  try { m = await createMGBA(); } catch (e) { status.textContent = `読み込み失敗: ${e.message}`; return; }
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  let loaded = false, paused = false, keys = 0, image, pixelRows = [], pixelHeap, cheats = [], name = 'game', clock = 0, nextAudio = 0, audioContext, audioGain;
  let volume = 1, muted = false;
  try { const sound = JSON.parse(localStorage.getItem('mgba-sound')); if (sound) { volume = Math.max(0,Math.min(1,Number(sound.volume) || 0)); muted = !!sound.muted; } } catch (_) {}
  let romKey = '', romLoading = false, loadSerial = 0, autoSave = true;
  try { autoSave = localStorage.getItem('mgba-auto-save') !== 'false'; } catch (_) {}
  let focused = true;
  let padKeys = 0, menuOpen = false, resumeAfterMenu = false;
  const held = new Set(), touches = new Map();
  const mapping = {KeyZ:0,KeyX:1,ShiftLeft:2,ShiftRight:2,Enter:3,ArrowRight:4,ArrowLeft:5,ArrowUp:6,ArrowDown:7,KeyS:8,KeyA:9};
  function updateKeys() { keys = padKeys; for (const code of held) keys |= 1 << mapping[code]; for (const bit of touches.values()) keys |= 1 << bit; }
  function release() { document.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); held.clear(); touches.clear(); updateKeys(); clock = 0; nextAudio = 0; }
  async function enableAudio() {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (!audioGain) { audioGain = audioContext.createGain(); audioGain.connect(audioContext.destination); audioGain.gain.value = muted ? 0 : volume; }
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
  $('welcome-open').disabled = false; $('welcome-open').onclick = () => $('open').click();
  $('open').disabled = false; status.textContent = 'ROMを選んで開始してください';
  $('open').onclick = () => { enableAudio().catch(() => {}); $('rom').click(); };
  $('rom').onchange = async () => {
    const file = $('rom').files[0]; if (!file) return;
    paused = true; release(); romLoading = true; const serial = ++loadSerial;
    status.textContent = 'ROMを読み込み中…';
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('ROMは64MB以下を選んでください');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      if (serial !== loadSerial) return;
      romKey = Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      loaded = !!upload(bytes, (p,n) => m._web_load(p,n));
      if (!loaded) throw new Error('対応するGBA / GB / GBC ROMを選んでください');
      document.querySelector('.play').classList.add('has-rom');
      name = file.name; canvas.width = m._web_width(); canvas.height = m._web_height();
      canvas.style.aspectRatio = `${canvas.width}/${canvas.height}`;
      image = ctx.createImageData(canvas.width, canvas.height); pixelHeap = null;
      cheats = []; renderCheats(); configureCheatFormats();
            {
        try {
          const stored = await readBrowserSave(romKey);
          if (serial !== loadSerial) return;
          if (stored && upload(new Uint8Array(stored.bytes),(p,n)=>m._web_save_import(p,n))) {
            m._web_reset(); $('save-name').textContent = 'ブラウザ保存から復元';
            browserSaveLabel('復元しました',stored.updated);
          } else $('browser-save-status').textContent = 'このROMの保存はまだありません。';
        } catch (_) { $('browser-save-status').textContent = 'ブラウザ保存を利用できません。ファイルに書き出してください。'; }
      }
      paused = false; $('pause').textContent = '一時停止'; status.textContent = name;
    } catch (e) { status.textContent = e.message; }
    romLoading = false;
    for (const id of ['pause','reset','export','import']) $(id).disabled = !loaded;
    $('screenshot-save').disabled = !loaded; $('quick-save').disabled = !loaded; $('cheat-add').disabled = !loaded;
    $('browser-save-now').disabled = !loaded; $('browser-save-delete').disabled = !loaded;
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
    saveBrowser().catch(()=>{});
    a.href = url; a.download = name.replace(/\.[^.]+$/, '') + '.sav'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  $('quick-save').onclick = () => $('export').click();
  $('import').onclick = () => { if (loaded) $('save').click(); };
  $('save').onchange = async () => {
    const file = $('save').files[0]; if (!file || !loaded) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('セーブファイルが大きすぎます');
      if (!upload(new Uint8Array(await file.arrayBuffer()), (p,n) => m._web_save_import(p,n))) throw new Error('セーブを読み込めませんでした');
      m._web_reset(); release(); status.textContent = 'セーブを読み込みました'; $('save-name').textContent = file.name; saveBrowser(true).catch(()=>{});
    } catch (e) { status.textContent = e.message; }
    $('save').value = '';
  };
  function syncFullscreen() {
    const scene = document.querySelector('.play');
    const active = document.fullscreenElement === scene || document.body.classList.contains('expanded');
    scene.classList.toggle('immersive', active);
    $('fullscreen-exit').hidden = !active;
    $('fullscreen').textContent = active ? '通常画面に戻る' : '画面を広げる';
    applyLayout(); release();
  }
  async function exitFullscreen() {
    document.body.classList.remove('expanded');
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) {} }
    syncFullscreen();
  }
  $('fullscreen-exit').onclick = exitFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  $('fullscreen').onclick = async () => {
    const scene = document.querySelector('.play');
    if (document.fullscreenElement || document.body.classList.contains('expanded')) { await exitFullscreen(); return; }
    if (scene.requestFullscreen) { try { await scene.requestFullscreen(); syncFullscreen(); return; } catch (_) {} }
    document.body.classList.add('expanded'); syncFullscreen();
  };
  addEventListener('keydown', e => { if (e.code === 'Escape' && document.body.classList.contains('expanded')) { e.preventDefault(); exitFullscreen(); } });
  function selectTab(name) {
    for (const tab of document.querySelectorAll('[data-tab]')) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $('panel-'+tab.dataset.tab).hidden = !active;
    }
  }
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.onclick = () => selectTab(tab.dataset.tab);
    tab.onkeydown = e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.code)) return;
      e.preventDefault(); e.stopPropagation();
      const tabs = [...document.querySelectorAll('[data-tab]')], i = tabs.indexOf(tab);
      const next = e.code === 'Home' ? 0 : e.code === 'End' ? tabs.length-1 : (i+(e.code==='ArrowRight'?1:tabs.length-1))%tabs.length;
      selectTab(tabs[next].dataset.tab); tabs[next].focus();
    };
  }
  function openSettings(tab) {
    if (tab) selectTab(tab);
    if (!menuOpen) { resumeAfterMenu = loaded && !paused; if (resumeAfterMenu) togglePause(); }
    menuOpen = true; padKeys = 0; release(); $('settings').showModal();
  }
  $('settings-open').onclick = () => openSettings();
  $('settings-close').onclick = () => $('settings').close();
  $('settings').addEventListener('close', () => {
    menuOpen = false; release();
    if (resumeAfterMenu && loaded && paused && !editing && !document.hidden) togglePause();
    resumeAfterMenu = false;
  });
  $('go-display').onclick = () => selectTab('display');
  addEventListener('keydown', e => {
    if (menuOpen || editing || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
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
  addEventListener('blur', () => { focused = false; padKeys = 0; release(); });
  addEventListener('focus', () => { focused = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveBrowser().catch(()=>{}); release(); if (document.hidden && loaded && !paused) togglePause(); });
  for (const b of document.querySelectorAll('[data-key]')) {
    b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('pressed'); touches.set(e.pointerId, +b.dataset.key); updateKeys(); enableAudio().catch(() => {}); };
    const end = e => { b.classList.remove('pressed'); touches.delete(e.pointerId); updateKeys(); };
    b.onpointerup = end; b.onpointercancel = end; b.onlostpointercapture = end;
  }
  const play = document.querySelector('.play');
  const groups = ['dpad','ab','shoulders','system'];
  let layout = {overlay:true,scale:.75,opacity:.55,positions:{},landscapePositions:{}}, editing = false, drag;
  try { const saved = JSON.parse(localStorage.getItem('mgba-touch-layout')); if (saved) layout = {...layout,...saved}; } catch (_) {}
  function applyLayout() {
    play.classList.toggle('overlay', layout.overlay || play.classList.contains('immersive'));
    play.classList.toggle('editing', editing);
    play.style.setProperty('--pad-scale', layout.scale);
    play.style.setProperty('--pad-opacity', layout.opacity);
    $('overlay').checked = layout.overlay;
    $('pad-scale').value = layout.scale; $('pad-opacity').value = layout.opacity;
    $('scale-value').value = Math.round(layout.scale*100)+'%'; $('opacity-value').value = Math.round(layout.opacity*100)+'%';
    $('edit-bar').hidden = !editing;
    $('pad-edit').disabled = !layout.overlay;
    $('pad-edit').textContent = editing ? '位置調整を終える' : '位置を調整';
    for (const group of groups) {
      const positions = matchMedia('(orientation:landscape)').matches ? layout.landscapePositions : layout.positions;
      const el = play.querySelector('.'+group), pos = positions?.[group];
      el.style.left = play.classList.contains('overlay') && pos ? pos.x+'%' : '';
      el.style.top = play.classList.contains('overlay') && pos ? pos.y+'%' : '';
    }
  }
  function storeLayout() { try { localStorage.setItem('mgba-touch-layout',JSON.stringify(layout)); } catch (_) {} }
  $('overlay').onchange = () => { layout.overlay = $('overlay').checked; editing = false; release(); applyLayout(); storeLayout(); };
  for (const [id,key] of [['pad-scale','scale'],['pad-opacity','opacity']]) $(id).oninput = () => { layout[key] = +$(id).value; applyLayout(); storeLayout(); };
  $('pad-edit').onclick = () => { editing = true; padKeys = 0; release(); if (loaded && !paused) togglePause(); applyLayout(); $('settings').close(); play.scrollIntoView({block:'center'}); };
  $('edit-done').onclick = () => { editing = false; applyLayout(); openSettings('display'); };
  $('pad-default').onclick = () => { layout = {overlay:true,scale:.75,opacity:.55,positions:{},landscapePositions:{}}; editing = false; release(); applyLayout(); storeLayout(); };
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
      const key = matchMedia('(orientation:landscape)').matches ? 'landscapePositions' : 'positions';
      layout[key] ||= {};
      layout[key][group] = {x:Math.max(5,Math.min(95,100*(e.clientX-rect.left-drag.dx)/rect.width)),y:Math.max(5,Math.min(95,100*(e.clientY-rect.top-drag.dy)/rect.height))};
      applyLayout();
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) el.addEventListener(type,e => { if (drag && drag.id === e.pointerId) { drag = null; storeLayout(); } });
  }
  applyLayout();
  matchMedia('(orientation:landscape)').addEventListener('change', () => { drag = null; release(); applyLayout(); });
  const controller = createController({$,play,release,
    onKeys:mask => { padKeys = mask; updateKeys(); },
    isBlocked:() => menuOpen || editing || document.hidden || !focused,
    isEditing:() => editing
  });
  $('clean-screen').onclick = () => {
    document.body.classList.add('clean-view');
    editing = false; applyLayout(); $('settings').close();
  };
  play.addEventListener('pointerdown', e => {
    if (!document.body.classList.contains('clean-view')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.body.classList.remove('clean-view'); release();
  },true);
  addEventListener('keydown', e => { if (document.body.classList.contains('clean-view') && e.code==='Escape') document.body.classList.remove('clean-view'); });
  function configureCheatFormats() {
    const formats = m._web_platform()===0 ? [[0,'自動判定'],[1,'CodeBreaker'],[2,'GameShark'],[3,'Action Replay'],[4,'VBA（アドレス:値）']] : [[0,'自動判定'],[1,'GameShark'],[2,'Game Genie'],[3,'VBA（アドレス:値）']];
    $('cheat-format').replaceChildren(...formats.map(([value,label])=>new Option(label,value)));
    $('cheat-status').textContent = 'コードを追加してください。';
  }
  function renderCheats() {
    $('cheat-list').replaceChildren();
    cheats.forEach((cheat,index) => {
      const row = document.createElement('div'), label = document.createElement('label'), toggle = document.createElement('input'), remove = document.createElement('button');
      row.className = 'cheat-item'; toggle.type = 'checkbox'; toggle.checked = cheat.enabled;
      label.append(toggle,document.createTextNode(' '+cheat.name));
      toggle.onchange = () => { if (m._web_cheat_enable(index, toggle.checked)) cheat.enabled = toggle.checked; };
      remove.textContent = '削除'; remove.onclick = () => { if (m._web_cheat_remove(index)) { cheats.splice(index,1); renderCheats(); } };
      row.append(label,remove); $('cheat-list').append(row);
    });
  }
  $('cheat-add').onclick = () => {
    if (!loaded) return;
    const title = $('cheat-name').value.trim() || 'チート '+(cheats.length+1), codes = $('cheat-code').value.trim();
    if (!codes) { $('cheat-status').textContent = 'コードを入力してください。'; return; }
    const encoder = new TextEncoder();
    const result = upload(encoder.encode(title+'\0'), p => upload(encoder.encode(codes+'\0'), q => m._web_cheat_add(p,q,+$('cheat-format').value)));
    if (result<0) { $('cheat-status').textContent = result===-1000 ? '追加できませんでした。入力サイズや登録数を確認してください。' : (-result)+'行目を読み込めません。コードと形式を確認してください。'; return; }
    cheats.push({name:title,enabled:true}); renderCheats(); $('cheat-code').value = ''; $('cheat-name').value = ''; $('cheat-status').textContent = '追加しました。チェックで有効・無効を切り替えられます。';
  };
  const localSaves = new LocalSaveStore();
  const readBrowserSave = key => localSaves.read(key);
  function browserSaveLabel(prefix,updated) { $('browser-save-status').textContent = prefix+'：'+new Date(updated).toLocaleTimeString('ja-JP'); }
  async function saveBrowser(force=false) {
    if (!loaded || romLoading || !romKey || (!autoSave && !force)) return;
    const key = romKey, n = m._web_save_export();
    if (!n) { if (force) $('browser-save-status').textContent = 'このゲームのセーブデータはまだありません。'; return; }
    const pointer = m._web_save_data(), bytes = m.HEAPU8.slice(pointer,pointer+n).buffer, updated = Date.now(), filename = name;
    try {
      await localSaves.write(key,{bytes,updated,filename});
      if (romKey === key) browserSaveLabel('ブラウザに保存しました',updated);
    } catch (_) { if (romKey === key) $('browser-save-status').textContent = '保存できませんでした。ファイルに書き出してください。'; }
  }
  $('auto-save').checked = autoSave;
  $('auto-save').onchange = () => { autoSave = $('auto-save').checked; try { localStorage.setItem('mgba-auto-save',String(autoSave)); } catch (_) {} if (autoSave) saveBrowser().catch(()=>{}); };
  $('browser-save-now').onclick = () => saveBrowser(true);
  $('browser-save-delete').onclick = async () => {
    if (!romKey) return;
    const key = romKey; autoSave = false; $('auto-save').checked = false;
    try { localStorage.setItem('mgba-auto-save','false'); } catch (_) {}
    try {
      await localSaves.remove(key);
      $('browser-save-status').textContent = 'ブラウザ保存を削除しました。自動保存はオフにしました。';
    } catch (_) { $('browser-save-status').textContent = '削除できませんでした。'; }
  };
  setInterval(() => { if (!paused && !document.hidden) saveBrowser().catch(()=>{}); },10000);
  addEventListener('pagehide', () => saveBrowser().catch(()=>{}));
  function updateSound() {
    $('volume').value = volume; $('volume-value').value = Math.round(volume*100)+'%'; $('mute').checked = muted;
    if (audioGain) audioGain.gain.setTargetAtTime(muted ? 0 : volume,audioContext.currentTime,.01);
    try { localStorage.setItem('mgba-sound',JSON.stringify({volume,muted})); } catch (_) {}
  }
  $('volume').oninput = () => { volume = +$('volume').value; updateSound(); };
  $('mute').onchange = () => { muted = $('mute').checked; updateSound(); };
  updateSound();
  $('screenshot-save').onclick = () => {
    if (!loaded) return;
    const filename = name.replace(/\.[^.]+$/,'')+'.png';
    canvas.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    },'image/png');
  };
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
    const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioGain);
    nextAudio = Math.max(nextAudio, audioContext.currentTime + .025); source.start(nextAudio); nextAudio += count/outputRate;
  }
  function tick(now) {
    controller.poll();
    if (loaded && !paused) {
      const step = 1000/m._web_fps(); if (!clock) clock = now;
      let frames = 0;
      while (now >= clock && frames++ < 4) { m._web_frame(keys); playAudio(); clock += step; }
      if (now-clock > step*4) clock = now;
      if (frames) {
        if (pixelHeap !== m.HEAPU8.buffer) {
          pixelHeap = m.HEAPU8.buffer;
          const p = m._web_pixels();
          pixelRows = Array.from({length:canvas.height}, (_,y) => m.HEAPU8.subarray(p+y*256*4,p+y*256*4+canvas.width*4));
        }
        for (let y=0; y<canvas.height; ++y) image.data.set(pixelRows[y],y*canvas.width*4);
        for (let i=3; i<image.data.length; i+=4) image.data[i] = 255;
        ctx.putImageData(image,0,0);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
