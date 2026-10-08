/* Mozilla Public License 2.0; see ../LICENSE. */
window.createController = function({$,play,release,onKeys,isBlocked,isEditing}) {
  const defaultButtons = [0,1,8,9,15,14,12,13,5,4];
  let controllerConfig = {enabled:true,preset:'standard',deadzone:.25,hideTouch:false,selected:'auto',buttons:[...defaultButtons]};
  try { const saved = JSON.parse(localStorage.getItem('mgba-controller')); if (saved) controllerConfig = {...controllerConfig,...saved}; } catch (_) {}
  const names = ['A','B','SELECT','START','→','←','↑','↓','R','L'];
  let controllerSignature = '', lastControllerLabel = '', lastLive = '';
  function storeController() { try { localStorage.setItem('mgba-controller',JSON.stringify(controllerConfig)); } catch (_) {} }
  function syncControllerUI() {
    $('controller-enabled').checked = controllerConfig.enabled;
    $('controller-preset').value = controllerConfig.preset;
    $('deadzone').value = controllerConfig.deadzone;
    $('deadzone-value').value = Math.round(controllerConfig.deadzone*100)+'%';
    $('hide-touch').checked = controllerConfig.hideTouch;
    $('controller-mapping').replaceChildren();
    names.forEach((name,bit) => {
      const label = document.createElement('label'), select = document.createElement('select'); label.textContent = name;
      select.setAttribute('aria-label',name+'の割り当て');
      for (let i=-1;i<32;i++) { const option = document.createElement('option'); option.value = i; option.textContent = i<0 ? '割り当てなし' : 'ボタン '+i; select.append(option); }
      select.value = controllerConfig.buttons[bit];
      select.onchange = () => { controllerConfig.buttons[bit] = +select.value; controllerConfig.preset = 'custom'; $('controller-preset').value = 'custom'; storeController(); };
      label.append(select); $('controller-mapping').append(label);
    });
  }
  $('controller-enabled').onchange = () => { controllerConfig.enabled = $('controller-enabled').checked; onKeys(0); storeController(); };
  $('controller-select').onchange = () => { controllerConfig.selected = $('controller-select').value; onKeys(0); storeController(); };
  $('controller-preset').onchange = () => {
    controllerConfig.preset = $('controller-preset').value;
    if (controllerConfig.preset !== 'custom') { controllerConfig.buttons = [...defaultButtons]; if (controllerConfig.preset === 'nintendo') { controllerConfig.buttons[0]=1; controllerConfig.buttons[1]=0; } }
    syncControllerUI(); storeController();
  };
  $('deadzone').oninput = () => { controllerConfig.deadzone = +$('deadzone').value; $('deadzone-value').value = Math.round(controllerConfig.deadzone*100)+'%'; storeController(); };
  $('hide-touch').onchange = () => { controllerConfig.hideTouch = $('hide-touch').checked; release(); storeController(); };
  $('controller-default').onclick = () => { controllerConfig.buttons = [...defaultButtons]; controllerConfig.preset = 'standard'; syncControllerUI(); storeController(); };
  syncControllerUI();
  function pollController() {
    let pads = [], failure = '';
    try { if (navigator.getGamepads) pads = Array.from(navigator.getGamepads()).filter(p=>p && p.connected); else failure = 'このブラウザはコントローラーに対応していません'; }
    catch (_) { failure = 'ブラウザでコントローラーへのアクセスが許可されていません'; }
    const signature = pads.map(p=>p.index+':'+p.id).join('|');
    if (signature !== controllerSignature) {
      controllerSignature = signature;
      $('controller-select').replaceChildren(new Option('自動で選ぶ','auto'),...pads.map(p=>new Option(p.id,String(p.index))));
      $('controller-select').value = pads.some(p=>String(p.index)===controllerConfig.selected) ? controllerConfig.selected : 'auto';
    }
    const pad = pads.find(p=>String(p.index)===controllerConfig.selected) || pads[0];
    const enabled = pad && controllerConfig.enabled;
    const label = failure || (pad ? pad.id + (controllerConfig.enabled ? '：接続中' : '：入力オフ') + (pad.mapping !== 'standard' ? '（割り当てを確認してください）' : '') : '未接続。Bluetooth設定で接続し、コントローラーのボタンを押してください。');
    if (label !== lastControllerLabel) {
      lastControllerLabel = label; $('controller-status').textContent = label;
      $('controller-badge').textContent = enabled ? 'パッド接続中' : pad ? 'パッドOFF' : 'パッド未接続';
      $('controller-badge').classList.toggle('connected',!!enabled);
    }
    play.classList.toggle('touch-hidden',!!enabled && controllerConfig.hideTouch && !isEditing());
    let mask = 0;
    if (enabled) {
      const pressed = pad.buttons.map((b,i)=>b.pressed || b.value>.5 ? i : -1).filter(i=>i>=0);
      const live = pressed.length ? '入力中：ボタン '+pressed.join(', ') : 'ボタンを押すと番号が表示されます';
      if (live !== lastLive) { lastLive = live; $('controller-live').textContent = live; }
      controllerConfig.buttons.forEach((index,bit) => { if (index>=0 && (pad.buttons[index]?.pressed || pad.buttons[index]?.value>.5)) mask |= 1<<bit; });
      const x = pad.axes[0] || 0, y = pad.axes[1] || 0, zone = controllerConfig.deadzone;
      if (x>zone) mask |= 1<<4; if (x<-zone) mask |= 1<<5;
      if (y>zone) mask |= 1<<7; if (y<-zone) mask |= 1<<6;
    } else if (lastLive) { lastLive = ''; $('controller-live').textContent = 'ボタンを押すと番号が表示されます'; }
    onKeys(isBlocked() ? 0 : mask);
  }
  return {poll:pollController};
};
