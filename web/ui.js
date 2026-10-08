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
