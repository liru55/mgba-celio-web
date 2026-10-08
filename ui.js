/* MPL-2.0. Presentation only: emulator and Celio state remain in their modules. */
(() => {
  const $=id=>document.getElementById(id),play=document.querySelector('.play');
  let touch=true;
  try { const saved=localStorage.getItem('mgba-touch-visible');touch=saved===null?matchMedia('(pointer:coarse)').matches:saved!=='false'; } catch(_) {}
  const label=document.createElement('label');label.className='row';label.innerHTML='<input id="touch-visible" type="checkbox">画面の操作ボタンを表示';
  $('panel-controls').prepend(label);
  const applyTouch=()=>{play.classList.toggle('no-touch',!touch);$('touch-visible').checked=touch;};
  $('touch-visible').onchange=()=>{touch=$('touch-visible').checked;applyTouch();try{localStorage.setItem('mgba-touch-visible',touch);}catch(_){}};applyTouch();
  new MutationObserver(()=>document.body.classList.toggle('ui-loaded',play.classList.contains('has-rom'))).observe(play,{attributes:true,attributeFilter:['class']});
  let toolbarVisible=true;
  try{toolbarVisible=localStorage.getItem('mgba-toolbar-visible')!=='false';}catch(_){}
  const toolbarLabel=document.createElement('label');toolbarLabel.className='row';toolbarLabel.innerHTML='<input id="toolbar-visible" type="checkbox">下の操作メニューを表示';$('panel-display').prepend(toolbarLabel);
  const hideToolbar=document.createElement('button');hideToolbar.type='button';hideToolbar.id='toolbar-hide';hideToolbar.textContent='⌄';hideToolbar.title='下のメニューを隠す';hideToolbar.setAttribute('aria-label','下のメニューを隠す');document.querySelector('.bar-game').append(hideToolbar);
  const restoreToolbar=document.createElement('button');restoreToolbar.type='button';restoreToolbar.id='toolbar-restore';restoreToolbar.textContent='メニュー';restoreToolbar.setAttribute('aria-label','下の操作メニューを表示');play.append(restoreToolbar);
  function applyToolbar(){play.classList.toggle('toolbar-hidden',!toolbarVisible);$('toolbar-visible').checked=toolbarVisible;restoreToolbar.hidden=toolbarVisible;try{localStorage.setItem('mgba-toolbar-visible',String(toolbarVisible));}catch(_){} }
  hideToolbar.onclick=()=>{toolbarVisible=false;applyToolbar();};restoreToolbar.onclick=()=>{toolbarVisible=true;applyToolbar();};$('toolbar-visible').onchange=()=>{toolbarVisible=$('toolbar-visible').checked;applyToolbar();};applyToolbar();
  function choose(mode){
    for(const type of ['local','online','usb']){$('link-'+type+'-panel').hidden=mode!==type;$('link-choose-'+type).setAttribute('aria-pressed',String(mode===type));}
  }
  $('link-choose-local').onclick=()=>choose('local');$('link-choose-online').onclick=()=>choose('online');$('link-choose-usb').onclick=()=>choose('usb');
  const phases=['connecting','waiting','connected','trading','finished'];
  const names={idle:'未接続',connecting:'接続準備中',waiting:'相手を待っています',connected:'接続済み',trading:'ケーブル通信中',finished:'通信終了',error:'接続終了'};
  document.addEventListener('celio:state',({detail})=>{
    const {phase,online,usb,room}=detail,badge=$('link-state-badge');badge.dataset.phase=phase;badge.textContent=names[phase]||names.idle;
    $('link-room-display').hidden=!room;$('link-room-display').textContent=room?room:'';
    const current=phases.indexOf(phase);for(const item of $('link-progress').children){const index=phases.indexOf(item.dataset.phase);item.classList.toggle('current',index===current);item.classList.toggle('done',current>=0&&index<current);}
    const active=['connecting','waiting','connected','trading'].includes(phase);for(const type of ['local','online','usb'])$('link-choose-'+type).disabled=active;
    if(active)choose(online?'online':usb?'usb':'local');
  });
  document.addEventListener('pointerdown',e=>{const audio=$('audio-popover');if(audio.open&&!audio.contains(e.target))audio.open=false;});
})();
