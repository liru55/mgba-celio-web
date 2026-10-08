/* Mozilla Public License 2.0; see ../LICENSE. */
(async () => {
  const $ = id => document.getElementById(id), status = $('status');
  let screenScale = 1;
  try { screenScale = Math.max(.5, Math.min(2, Number(localStorage.getItem('mgba-screen-scale')) || 1)); } catch (_) {}
  function applyScreenScale() {
    document.documentElement.style.setProperty('--screen-scale', screenScale);
    $('screen-scale').value = screenScale;
    $('screen-scale-value').textContent = Math.round(screenScale * 100) + '%';
    try { localStorage.setItem('mgba-screen-scale', screenScale); } catch (_) {}
  }
  $('screen-scale').oninput = () => { screenScale = Number($('screen-scale').value); applyScreenScale(); };
  $('screen-fit').onclick = () => { screenScale = 1; applyScreenScale(); };
  applyScreenScale();
  let m;
  try { m = await createMGBA({print: () => {}}); } catch (e) { status.textContent = `読み込み失敗: ${e.message}`; return; }
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  const screenEffects = createScreenEffects(canvas);
  let loaded = false, paused = false, keys = 0, image, pixelRows = [], pixelHeap, cheats = [], name = 'game', clock = 0, nextAudio = 0, audioContext, audioGain;
  const audioSources = new Set();
  const vibrationSupported=typeof navigator.vibrate==='function';
  let vibrationEnabled=true,lastVibration=-Infinity;
  try {vibrationEnabled=localStorage.getItem('mgba-touch-vibration')!=='false';}catch(_){}
  $('touch-vibration').checked=vibrationSupported&&vibrationEnabled;
  $('touch-vibration').disabled=!vibrationSupported;
  $('touch-vibration-status').textContent=vibrationSupported?'タッチ操作で短く振動します。端末の設定によって振動しない場合があります。':'このブラウザは振動に対応していません。iPhone／iPadのSafariでは利用できません。';
  function pulseTouch(){
    const now=performance.now();if(!vibrationSupported||!vibrationEnabled||document.hidden||now-lastVibration<60)return;
    lastVibration=now;try{navigator.vibrate(12);}catch(_){}
  }
  $('touch-vibration').onchange=()=>{vibrationEnabled=$('touch-vibration').checked;try{localStorage.setItem('mgba-touch-vibration',String(vibrationEnabled));}catch(_){}if(vibrationEnabled)pulseTouch();};
  let volume = 1, muted = false;
  try { const sound = JSON.parse(localStorage.getItem('mgba-sound')); if (sound) { volume = Math.max(0,Math.min(1,Number(sound.volume) || 0)); muted = !!sound.muted; } } catch (_) {}
  let communication = null, romBytes = null, pixelBase = 0, skins=null,skinKeys=0,skinHoldSpeed=null;
  const memoryViewer=createMemoryViewer({m,$,available:()=>loaded&&!romLoading&&!communication?.busy});
  let romKey = '', romLoading = false, loadSerial = 0, autoSave = true;
  try { autoSave = localStorage.getItem('mgba-auto-save') !== 'false'; } catch (_) {}
  let speed = 1;
  try { const saved = Number(localStorage.getItem('mgba-speed')); if ([1,1.5,2,3,4].includes(saved)) speed = saved; } catch (_) {}
  let fastSpeed = speed !== 1 ? speed : 2;
  try { const saved = Number(localStorage.getItem('mgba-fast-speed')); if ([1.5,2,3,4].includes(saved)) fastSpeed = saved; } catch (_) {}
  function updateSpeedButton() { $('speed-toggle').textContent = speed === 1 ? '倍速 OFF' : `倍速 ${speed}×`; }
  updateSpeedButton();
  $('game-speed').value = speed;
  $('game-speed').onchange = () => {
    speed = Number($('game-speed').value); clock = 0; nextAudio = 0;
    try { localStorage.setItem('mgba-speed',speed); } catch (_) {}
    for (const source of audioSources) { try { source.stop(); } catch (_) {} } audioSources.clear();
    if (speed !== 1) { fastSpeed = speed; try { localStorage.setItem('mgba-fast-speed',fastSpeed); } catch (_) {} }
    updateSpeedButton(); updateSound();
  };
  $('speed-toggle').onclick = () => { $('game-speed').value = speed === 1 ? fastSpeed : 1; $('game-speed').onchange(); };
  let focused = true;
  let padKeys = 0, menuOpen = false, resumeAfterMenu = false;
  const held = new Set(), touches = new Map(), dpadPointers = new Set();
  const mapping = {KeyZ:0,KeyX:1,ShiftLeft:2,ShiftRight:2,Enter:3,ArrowRight:4,ArrowLeft:5,ArrowUp:6,ArrowDown:7,KeyS:8,KeyA:9};
  function updateKeys() { keys = padKeys | skinKeys; for (const code of held) keys |= 1 << mapping[code]; for (const mask of touches.values()) keys |= mask; }
  function release() { document.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); held.clear(); touches.clear(); dpadPointers.clear(); skins?.release(); skinKeys=0; updateKeys(); clock = 0; nextAudio = 0; }
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
  function updatePauseBanner() { $('pause-banner').hidden = communication?.busy || !loaded || !paused || menuOpen || editing || romLoading; }
  function togglePause() {
    if (!loaded || communication?.busy) return;
    paused = !paused; release();
    $('pause').textContent = paused ? '再開' : '一時停止';
    status.textContent = paused ? '一時停止中' : name; updatePauseBanner();
    if (!paused) enableAudio().catch(() => {});
  }
  $('welcome-open').disabled = false; $('welcome-open').onclick = () => $('open').click();
  $('open').disabled = false; status.textContent = 'ROMを選んで開始してください';
  $('open').onclick = () => { enableAudio().catch(() => {}); $('rom').click(); };
  $('rom').onchange = async () => {
    const file = $('rom').files[0]; if (!file) return;
    paused = true; release(); romLoading = true; quickState = null; $('quick-state-save').disabled = $('quick-state-load').disabled = true; const serial = ++loadSerial;
    status.textContent = 'ROMを読み込み中…';
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('ROMは64MB以下を選んでください');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      if (serial !== loadSerial) return;
      romKey = Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      loaded = !!upload(bytes, (p,n) => m._web_load(p,n));
      if (!loaded) throw new Error('対応するGBA / GB / GBC ROMを選んでください');
      romBytes = bytes;
      document.querySelector('.play').classList.add('has-rom');
      name = file.name; canvas.width = m._web_width(); canvas.height = m._web_height();
      canvas.style.aspectRatio = `${canvas.width}/${canvas.height}`;
      document.querySelector('.play').style.setProperty('--game-aspect',canvas.width/canvas.height);
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
      try { quickState = await localSaves.read('state:'+romKey); } catch (_) {}
      if (serial !== loadSerial) return;
      paused = false; $('pause').textContent = '一時停止'; status.textContent = name;
    } catch (e) { status.textContent = e.message; }
    romLoading = false; updatePauseBanner();
    for (const id of ['pause','reset','export','import']) $(id).disabled = !loaded;
    $('import-main').disabled = !loaded; $('screenshot-save').disabled = !loaded; $('quick-save').disabled = !loaded; $('cheat-add').disabled = !loaded;
    $('quick-state-save').disabled = !loaded; $('quick-state-load').disabled = !loaded || !quickState;
    $('browser-save-now').disabled = !loaded; $('browser-save-delete').disabled = !loaded;
    $('rom').value = '';
    memoryViewer.onGame();
    skins?.onGame();
    if (loaded) await communication?.onGame();
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
  $('import-main').onclick = () => $('import').click();
  $('layout-main').onclick = () => openSettings('controls');
  $('cheats-main').onclick = () => openSettings('cheats');
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
    $('fullscreen-layout').hidden = !active;
    $('fullscreen').textContent = active ? '戻る' : '全画面';
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
    const dialog = tab === 'link' ? $('link-dialog') : $('settings');
    if (tab && tab !== 'link') selectTab(tab);
    const other = dialog === $('settings') ? $('link-dialog') : $('settings');
    if (other.open) other.close();
    const scene=document.querySelector('.play');
    (document.fullscreenElement===scene?scene:document.querySelector('main')).append(dialog);
    if (!menuOpen) { resumeAfterMenu = loaded && !paused; if (resumeAfterMenu) togglePause(); }
    menuOpen = true; updatePauseBanner(); padKeys = 0; release(); if (!dialog.open) dialog.showModal();
  }
  $('settings-open').onclick = () => openSettings();
  $('file-menu-open').onclick=()=>openSettings('save');
  $('about-open').onclick=()=>openSettings('help');
  $('link-settings-open').onclick=()=>openSettings('link');
  $('link-dialog-close').onclick=()=>$('link-dialog').close();
  $('settings-close').onclick = () => $('settings').close();
  for (const dialog of [$('settings'),$('link-dialog')]) dialog.addEventListener('close', () => {
    if ($('settings').open || $('link-dialog').open) return;
    menuOpen = false; release();
    if (resumeAfterMenu && loaded && paused && !editing && !document.hidden) togglePause();
    resumeAfterMenu = false; updatePauseBanner();
  });
  $('go-display').onclick = () => selectTab('controls');
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
    b.onpointerdown = e => { if (b.closest('.dpad') && linkedDpad) return; e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('pressed'); if(e.pointerType==='touch')pulseTouch(); touches.set(e.pointerId, 1 << +b.dataset.key); updateKeys(); enableAudio().catch(() => {}); };
    const end = e => { b.classList.remove('pressed'); touches.delete(e.pointerId); updateKeys(); };
    b.onpointerup = end; b.onpointercancel = end; b.onlostpointercapture = end;
  }
  const play = document.querySelector('.play');
  play.append($('edit-bar'));
  const groups = ['dpad','ab','shoulder-l','shoulder-r','system','quick-action-speed','quick-action-save','quick-action-load'];
  const groupElement = group => group.startsWith('quick-') ? $(group) : play.querySelector('.'+group);
  let layout = {overlay:false,scale:.75,opacity:.8,leftSize:1,rightSize:1,positions:{},landscapePositions:{}}, editing = false, drag;
  try { const saved = JSON.parse(localStorage.getItem('mgba-touch-layout')); if (saved) layout = {...layout,...saved}; } catch (_) {}
  // Migrate the previous shared toolbar position without losing the saved layout.
  for (const key of ['positions','landscapePositions']) {
    const old = layout[key]?.['quick-actions'];
    if (old) {
      const width = Math.max(320,play.clientWidth);
      for(const [id,offset] of [['quick-action-speed',-110],['quick-action-save',0],['quick-action-load',100]])
        layout[key][id] ||= {x:old.x+offset/width*100,y:old.y};
      delete layout[key]['quick-actions'];
    }
  }
  for (const key of ['positions','landscapePositions']) {
    const old=layout[key]?.shoulders;
    if(old){layout[key]['shoulder-l'] ||= {x:Math.max(5,old.x-32),y:old.y};layout[key]['shoulder-r'] ||= {x:Math.min(95,old.x+32),y:old.y};delete layout[key].shoulders;}
  }
  function applyLayout() {
    play.classList.toggle('overlay', layout.overlay || editing);
    play.classList.toggle('editing', editing);
    // Detach movable actions from the toolbar while the toolbar is hidden.
    for (const id of ['quick-action-speed','quick-action-save','quick-action-load']) {
      const target=editing ? play : $('quick-actions');
      // Moving a captured element during pointermove releases pointer capture on iOS.
      if($(id).parentElement!==target)target.append($(id));
    }
    play.style.setProperty('--pad-scale', layout.scale);
    play.style.setProperty('--pad-opacity', layout.opacity);
    $('overlay').checked = layout.overlay;
    $('pad-scale').value = layout.scale; $('pad-opacity').value = layout.opacity;
    $('scale-value').value = Math.round(layout.scale*100)+'%'; $('opacity-value').value = Math.round(layout.opacity*100)+'%';
    for(const [id,key,css] of [['left','leftSize','--left-size'],['right','rightSize','--right-size']]) {
      const size=layout[key]||1;play.style.setProperty(css,size);$(id+'-size').value=size;$(id+'-size-value').value=Math.round(size*100)+'%';
    }
    $('edit-bar').hidden = !editing;
    requestAnimationFrame(placeEditor);
    $('pad-edit').disabled = !!communication?.busy || !!skins?.active();
    $('pad-edit').textContent = editing ? '位置調整を終える' : 'ボタンの位置を調整';
    for (const group of groups) {
      const positions = matchMedia('(orientation:landscape)').matches ? layout.landscapePositions : layout.positions;
      const el = groupElement(group), pos = positions?.[group];
      const quick = group.startsWith('quick-');
      const movable = quick || play.classList.contains('overlay');
      el.style.left = movable && pos ? pos.x+'%' : '';
      el.style.top = movable && pos ? pos.y+'%' : '';
      if (quick) {
        el.classList.toggle('custom-position', !!pos);
        // Keep every action reachable when the viewport or fullscreen size changes.
        if (pos) {
          const bounds = play.getBoundingClientRect();
          const halfWidth = el.offsetWidth/2 + 8, halfHeight = el.offsetHeight/2 + 8;
          const clamp = (value, half, size) => Math.max(Math.min(half,size/2),Math.min(Math.max(size-half,size/2),value));
          el.style.left = clamp(pos.x*bounds.width/100,halfWidth,bounds.width)+'px';
          el.style.top = clamp(pos.y*bounds.height/100,halfHeight,bounds.height)+'px';
        }
      }
    }
  }
  function storeLayout() { try { localStorage.setItem('mgba-touch-layout',JSON.stringify(layout)); } catch (_) {} }
  $('overlay').onchange = () => { layout.overlay = $('overlay').checked; editing = false; release(); applyLayout(); storeLayout(); };
  for (const [id,key] of [['pad-scale','scale'],['pad-opacity','opacity'],['left-size','leftSize'],['right-size','rightSize']]) $(id).oninput = () => { layout[key] = +$(id).value; applyLayout(); storeLayout(); };
  $('pad-edit').onclick = () => { layout.overlay=true; applyLayout(); editing = true; padKeys = 0; release(); if (loaded && !paused) togglePause(); applyLayout(); $('settings').close(); play.scrollIntoView({block:'center'}); };
  $('fullscreen-layout').onclick = () => openSettings('controls');
  $('edit-done').onclick = () => { editing = false; applyLayout(); openSettings('controls'); };
  function resetLayout(keepEditing=false) { layout = {overlay:false,scale:.75,opacity:.8,leftSize:1,rightSize:1,positions:{},landscapePositions:{}}; editing = keepEditing; release(); applyLayout(); storeLayout(); }
  $('pad-default').onclick = () => resetLayout();
  $('edit-reset').onclick = () => resetLayout(true);
  for (const group of groups) {
    const el = groupElement(group);
    el.addEventListener('click', e => { if (editing) { e.preventDefault(); e.stopImmediatePropagation(); } },true);
    el.addEventListener('pointerdown', e => {
      if (!editing || (!group.startsWith('quick-') && !play.classList.contains('overlay'))) return;
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
      // A freely moved pad uses its saved overlay coordinates after editing ends.
      if(!group.startsWith('quick-'))layout.overlay=true;
      layout[key][group] = {x:Math.max(5,Math.min(95,100*(e.clientX-rect.left-drag.dx)/rect.width)),y:Math.max(5,Math.min(95,100*(e.clientY-rect.top-drag.dy)/rect.height))};
      applyLayout();
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) el.addEventListener(type,e => { if (drag && drag.id === e.pointerId) { drag = null; storeLayout(); } });
  }
  // Non-passive fallback for iOS Safari; only block page panning inside the editor.
  document.addEventListener('touchmove', e => {
    if (editing && play.contains(e.target) && e.cancelable) e.preventDefault();
  }, {passive:false,capture:true});
  const editBar=$('edit-bar'), editHandle=$('edit-handle');
  let editorPositions={}, editorDrag;
  try { editorPositions=JSON.parse(localStorage.getItem('mgba-editor-position'))||{}; } catch (_) {}
  function placeEditor() {
    if (!editing) return;
    const key=matchMedia('(orientation:landscape)').matches?'landscape':'portrait', pos=editorPositions[key];
    if (!pos) return;
    const bounds=play.getBoundingClientRect(), width=editBar.offsetWidth, height=editBar.offsetHeight;
    editBar.style.left=Math.max(8,Math.min(bounds.width-width-8,pos.x*bounds.width))+'px';
    editBar.style.top=Math.max(8,Math.min(bounds.height-height-8,pos.y*bounds.height))+'px';
    editBar.style.bottom='auto';editBar.style.transform='none';
  }
  editHandle.addEventListener('pointerdown',e=>{
    if (!editing) return;
    e.preventDefault();e.stopPropagation();
    const rect=editBar.getBoundingClientRect();editorDrag={id:e.pointerId,dx:e.clientX-rect.left,dy:e.clientY-rect.top};
    editHandle.setPointerCapture(e.pointerId);
  });
  editHandle.addEventListener('pointermove',e=>{
    if (!editorDrag||editorDrag.id!==e.pointerId) return;
    e.preventDefault();e.stopPropagation();const bounds=play.getBoundingClientRect();
    const key=matchMedia('(orientation:landscape)').matches?'landscape':'portrait';
    editorPositions[key]={x:(e.clientX-bounds.left-editorDrag.dx)/bounds.width,y:(e.clientY-bounds.top-editorDrag.dy)/bounds.height};placeEditor();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])editHandle.addEventListener(type,e=>{
    if(editorDrag?.id!==e.pointerId)return;editorDrag=null;
    try {localStorage.setItem('mgba-editor-position',JSON.stringify(editorPositions));}catch(_){}
  });
  addEventListener('resize',()=>{
    editBar.style.left=editBar.style.top=editBar.style.bottom=editBar.style.transform='';placeEditor();
  });
  const dpad = play.querySelector('.dpad');
  let linkedDpad = true;
  try { linkedDpad = localStorage.getItem('mgba-dpad-linked') !== 'false'; } catch (_) {}
  function applyDpad() {
    release(); dpad.classList.toggle('linked', linkedDpad); $('dpad-linked').checked = linkedDpad;
    try { localStorage.setItem('mgba-dpad-linked', linkedDpad); } catch (_) {}
  }
  $('dpad-linked').onchange = () => { linkedDpad = $('dpad-linked').checked; applyDpad(); };
  function slideDpad(e) {
    const r = dpad.getBoundingClientRect(), x = (e.clientX-r.left-r.width/2)/(r.width/2), y = (e.clientY-r.top-r.height/2)/(r.height/2);
    let mask = 0;
    if (Math.abs(x) <= 1.25 && Math.abs(y) <= 1.25 && Math.max(Math.abs(x),Math.abs(y)) > .18) {
      if (Math.abs(x) > Math.abs(y)*.55) mask |= 1 << (x > 0 ? 4 : 5);
      if (Math.abs(y) > Math.abs(x)*.55) mask |= 1 << (y > 0 ? 7 : 6);
    }
    if(mask&&mask!==touches.get(e.pointerId)&&e.pointerType==='touch')pulseTouch();
    touches.set(e.pointerId,mask); updateKeys(); paintDpad();
  }
  function paintDpad() {
    let mask = 0; for (const id of dpadPointers) mask |= touches.get(id) || 0;
    for (const b of dpad.querySelectorAll('[data-key]')) b.classList.toggle('pressed',!!(mask & (1 << +b.dataset.key)));
  }
  dpad.addEventListener('pointerdown', e => {
    if (!linkedDpad || editing) return;
    e.preventDefault(); dpad.setPointerCapture(e.pointerId); dpadPointers.add(e.pointerId); slideDpad(e); enableAudio().catch(() => {});
  });
  dpad.addEventListener('pointermove', e => { if (!dpadPointers.has(e.pointerId)) return; e.preventDefault(); slideDpad(e); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) dpad.addEventListener(type,e => {
    if (!dpadPointers.delete(e.pointerId)) return;
    touches.delete(e.pointerId); updateKeys(); paintDpad();
  });
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'&&!editing){const button=e.target.closest('button');if(button&&!button.disabled&&!button.hasAttribute('data-key'))pulseTouch();}
  },{capture:true});
  play.addEventListener('contextmenu', e => e.preventDefault());
  play.addEventListener('selectstart', e => e.preventDefault());
  applyDpad();
  applyLayout();
  new ResizeObserver(() => applyLayout()).observe(play);
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
  $('pause-banner').onclick = () => { if (loaded && paused && !menuOpen && !editing) togglePause(); };
  play.addEventListener('pointerdown', e => {
    if (!loaded || !paused || menuOpen || editing || romLoading) return;
    if (e.target === canvas || e.target === play || e.target.id === 'effect-screen') {
      e.preventDefault(); e.stopImmediatePropagation(); togglePause();
    }
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
  let quickState = null, quickBusy = false, quickMessageTimer;
  let showQuick = true;
  try { showQuick = localStorage.getItem('mgba-quick-controls') !== 'false'; } catch (_) {}
  function applyQuickControls() { $('show-quick').checked = showQuick; $('quick-actions').hidden = !showQuick; }
  $('show-quick').onchange = () => { showQuick = $('show-quick').checked; applyQuickControls(); try { localStorage.setItem('mgba-quick-controls',showQuick); } catch (_) {} };
  applyQuickControls();
  function quickMessage(text) { $('quick-message').textContent = text; $('quick-message').hidden = false; clearTimeout(quickMessageTimer); quickMessageTimer = setTimeout(() => $('quick-message').hidden = true,4000); }
  $('quick-state-save').onclick = async () => {
    if (!loaded || romLoading || quickBusy) return;
    quickBusy = true; const key = romKey, serial = loadSerial;
    try {
      const size = m._web_state_export(); if (!size) throw new Error('途中の状態を保存できませんでした');
      const pointer = m._web_state_data();
      const saved = {bytes:m.HEAPU8.slice(pointer,pointer+size).buffer,picture:image.data.slice().buffer,updated:Date.now()};
      quickState = saved; $('quick-state-load').disabled = false;
      try { await localSaves.write('state:'+key,saved); if (serial === loadSerial) quickMessage('クイック保存しました（このROMに1つ）'); }
      catch (_) { if (serial === loadSerial) quickMessage('今回は保存しました。ブラウザへは保存できませんでした。'); }
    } catch (error) { quickMessage(error.message); }
    finally { quickBusy = false; }
  };
  $('quick-state-load').onclick = () => {
    if (!loaded || romLoading || quickBusy || !quickState) return;
    try {
      if (!upload(new Uint8Array(quickState.bytes),(p,n)=>m._web_state_import(p,n))) throw new Error('クイック保存を読み込めませんでした');
      release(); for (const source of audioSources) { try { source.stop(); } catch (_) {} } audioSources.clear();
      m._web_audio_read();
      if (quickState.picture?.byteLength === image.data.byteLength) { image.data.set(new Uint8Array(quickState.picture)); ctx.putImageData(image,0,0); screenEffects.render(image); }
      quickMessage('クイック保存の時点に戻りました');
    } catch (error) { quickMessage(error.message); }
  };

  const readBrowserSave = key => localSaves.read(key);
  function browserSaveLabel(prefix,updated) { $('browser-save-status').textContent = prefix+'：'+new Date(updated).toLocaleTimeString('ja-JP'); }
  async function saveBrowser(force=false,strict=false) {
    if (!loaded || romLoading || !romKey || communication?.busy || (communication?.blockSave && !force) || (!autoSave && !force)) return;
    const key = romKey, n = m._web_save_export();
    if (!n) { if (force) $('browser-save-status').textContent = 'このゲームのセーブデータはまだありません。'; return; }
    const pointer = m._web_save_data(), bytes = m.HEAPU8.slice(pointer,pointer+n).buffer, updated = Date.now(), filename = name;
    try {
      await localSaves.write(key,{bytes,updated,filename});
      if (romKey === key) browserSaveLabel('ブラウザに保存しました',updated);
    } catch (_) { if (romKey === key) $('browser-save-status').textContent = '保存できませんでした。ファイルに書き出してください。'; if(strict)throw new Error('セーブを保存できませんでした。先にファイルに書き出してください。'); }
  }
  window.prepareCacheReload = async () => {
    if(communication?.busy)throw new Error('通信を終了してからキャッシュを削除してください。');
    await saveBrowser(true,true);
  };
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
    $('volume').value = $('volume-main').value = volume;
    $('volume-value').value = $('volume-main-value').value = Math.round(volume*100)+'%'; $('mute').checked = muted;
    $('mute-main').textContent = muted ? '音を戻す' : '音を消す';
    $('mute-main').setAttribute('aria-pressed',String(muted));
    $('volume-main').classList.toggle('muted',muted);
    if (audioGain) audioGain.gain.setTargetAtTime(muted ? 0 : volume,audioContext.currentTime,.01);
    try { localStorage.setItem('mgba-sound',JSON.stringify({volume,muted})); } catch (_) {}
  }
  for (const id of ['volume','volume-main']) $(id).oninput = () => { volume = +$(id).value; updateSound(); };
  $('mute-main').onclick = () => { muted = !muted; updateSound(); enableAudio().catch(()=>{}); };
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
    if (!n || muted || volume === 0 || !audioContext || audioContext.state !== 'running') return;
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
    const source = audioContext.createBufferSource(); source.buffer = buffer; source.playbackRate.value = speed; source.connect(audioGain);
    audioSources.add(source); source.onended = () => audioSources.delete(source);
    nextAudio = Math.max(nextAudio, audioContext.currentTime + .025); source.start(nextAudio); nextAudio += count/outputRate/speed;
  }
  const disabledBeforeLink = new Map();
  communication = createLinkSession({m,$,upload,store:localSaves,
    getGame:() => ({loaded,bytes:romBytes,key:romKey,name,cheats:cheats.length>0}),
    beforeStart:() => saveBrowser(true),
    release, audio:playAudio,
    refresh:() => { pixelHeap=null; if (image) drawFrame(); },
    open:() => openSettings('link'), close:() => { for (const dialog of [$('settings'),$('link-dialog')]) if(dialog.open)dialog.close(); },
    mode:(busy,running) => {
      release(); editing=false; resumeAfterMenu=false;
      if (busy) {
        $('game-speed').value=1; $('game-speed').onchange();
        if (!disabledBeforeLink.size) {
          for(const id of ['pause','reset','import','import-main','open','welcome-open','cheat-add','quick-state-save','quick-state-load','speed-toggle','game-speed','browser-save-now','browser-save-delete','auto-save','pad-edit']) {
            disabledBeforeLink.set(id,$(id).disabled); $(id).disabled=true;
          }
          for(const input of $('cheat-list').querySelectorAll('input,button')) input.disabled=true;
        }
      } else {
        for(const [id,value] of disabledBeforeLink) $(id).disabled=value;
        disabledBeforeLink.clear();
      }
      paused=busy||!running; clock=0; nextAudio=0;
      $('pause').textContent=paused?'再開':'一時停止';
      document.body.classList.toggle('link-mode',busy);
      applyLayout(); updatePauseBanner();
      if (running) enableAudio().catch(()=>{});
    }
  });
  skins=createSkins({m,$,available:()=>loaded,
    onKeys:mask=>{skinKeys=mask;updateKeys();if(mask)enableAudio().catch(()=>{});},
    blocked:()=>!loaded||(!communication?.busy&&paused)||menuOpen||editing||document.hidden,
    pulse:pulseTouch,onLayout:applyLayout,
    action:type=>{
      if(type==='menu')openSettings();
      if(type==='save')$('quick-state-save').click();
      if(type==='load')$('quick-state-load').click();
      if(type==='speed')$('speed-toggle').click();
      if(type==='holdSpeed'&&!communication?.busy&&skinHoldSpeed===null){skinHoldSpeed=speed;$('game-speed').value=fastSpeed;$('game-speed').onchange();}
      if(type==='releaseSpeed'&&skinHoldSpeed!==null){const original=skinHoldSpeed;skinHoldSpeed=null;$('game-speed').value=original;$('game-speed').onchange();}
    }
  });
  function drawFrame() {
    const p=m._web_pixels();
    if (pixelHeap !== m.HEAPU8.buffer || pixelBase !== p) {
      pixelHeap=m.HEAPU8.buffer; pixelBase=p;
      pixelRows=Array.from({length:canvas.height},(_,y)=>m.HEAPU8.subarray(p+y*256*4,p+y*256*4+canvas.width*4));
    }
    for(let y=0;y<canvas.height;y++) image.data.set(pixelRows[y],y*canvas.width*4);
    for(let i=3;i<image.data.length;i+=4) image.data[i]=255;
    ctx.putImageData(image,0,0); screenEffects.render(image);
  }
  function tick(now) {
    controller.poll();
    if (communication.busy) {
      if (communication.tick(now,menuOpen || document.hidden ? 0 : keys)) drawFrame();
      requestAnimationFrame(tick); return;
    }
    if (loaded && !paused) {
      const step = 1000/(m._web_fps()*speed), limit = Math.ceil(4*speed); if (!clock) clock = now;
      let frames = 0;
      while (now >= clock && frames++ < limit) { m._web_frame(keys); playAudio(); clock += step; }
      if (now-clock > step*limit) clock = now;
      if (frames) drawFrame();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

})();
