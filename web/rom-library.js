/* MPL-2.0. Optional, device-only ROM library; separate from save data and app cache. */
window.createROMLibrary=({$,getGame,load,open,blocked})=>{
  const section=document.createElement('section');section.className='settings-section rom-library';
  section.innerHTML='<h3>この端末のROM</h3><p class="subtext">保存したROMを次回も一覧から開けます。外部には送信しません。</p><label class="row"><input id="rom-remember" type="checkbox">読み込んだROMを自動で記憶する</label><button id="rom-store" class="wide" disabled>今のROMをこの端末に保存</button><p id="rom-library-status" role="status"></p><div id="rom-library-list"></div><small>利用する権利のあるROMを保存してください。端末の空き容量不足やブラウザのデータ削除で消える場合があります。ROMの削除ではセーブは消えません。</small>';
  $('panel-save').prepend(section);
  const welcome=document.createElement('button');welcome.id='rom-library-open';welcome.hidden=true;welcome.textContent='保存済みROMから選ぶ';welcome.onclick=open;$('welcome-open').after(welcome);
  const remember=$('rom-remember'),storeButton=$('rom-store'),status=$('rom-library-status'),list=$('rom-library-list');
  try{remember.checked=localStorage.getItem('mgba-remember-rom')==='true';}catch(_){}
  let pending,busy=false;
  async function database(){return pending ||= new Promise((resolve,reject)=>{const q=indexedDB.open('mgba-local-roms',1);q.onupgradeneeded=()=>{q.result.createObjectStore('roms');q.result.createObjectStore('metadata');};q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();pending=null;};resolve(q.result);};q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('ROMの保存先を開けません'));}).catch(e=>{pending=null;throw e;});}
  async function read(store,key){const db=await database();return new Promise((resolve,reject)=>{const q=key===undefined?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
  async function change(fn){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction(['roms','metadata'],'readwrite');fn(t);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
  function error(e){status.textContent=e?.name==='QuotaExceededError'?'空き容量が足りません。不要な保存済みROMを削除してください。':'保存領域を利用できません：'+(e?.message||e);}
  function button(label,fn,cls=''){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls;b.onclick=fn;return b;}
  async function refresh(){
    const entries=(await read('metadata')).sort((a,b)=>b.updated-a.updated);list.replaceChildren();welcome.hidden=!entries.length;welcome.textContent='保存済みROMから選ぶ（'+entries.length+'）';
    if(!entries.length){const p=document.createElement('p');p.className='subtext';p.textContent='保存済みROMはありません。';list.append(p);}
    for(const entry of entries){const row=document.createElement('div');row.className='rom-entry';const info=document.createElement('div'),title=document.createElement('span'),size=document.createElement('small');title.textContent=entry.name;size.textContent=(entry.size/1024/1024).toFixed(1)+' MB';info.append(title,size);const actions=document.createElement('div');actions.className='rom-entry-actions';
      actions.append(button('開く',async()=>{if(busy||blocked()){status.textContent='通信や読み込みを終了してから開いてください。';return;}busy=true;try{const file=await read('roms',entry.key);if(!file)throw Error('ROMが見つかりません');await load(new File([file],entry.name));}catch(e){error(e);}finally{busy=false;}}),button('削除',async()=>{if(busy)return;busy=true;try{await change(t=>{t.objectStore('roms').delete(entry.key);t.objectStore('metadata').delete(entry.key);});await refresh();status.textContent=entry.name+'を端末のROM一覧から削除しました。セーブは保持しています。';}catch(e){error(e);}finally{busy=false;}},'secondary danger'));row.append(info,actions);list.append(row);}
  }
  async function saveCurrent(){const game=getGame();if(busy||!game.loaded||!game.bytes||!game.key)return;busy=true;storeButton.disabled=true;try{const file=game.bytes.slice().buffer;await change(t=>{t.objectStore('roms').put(file,game.key);t.objectStore('metadata').put({key:game.key,name:game.name,size:file.byteLength,updated:Date.now()},game.key);});await refresh();status.textContent='この端末に保存しました。次回は保存済みROMの一覧から開けます。';try{await navigator.storage?.persist?.();}catch(_){} }catch(e){error(e);}finally{busy=false;storeButton.disabled=!getGame().loaded;}}
  storeButton.onclick=saveCurrent;
  remember.onchange=()=>{try{localStorage.setItem('mgba-remember-rom',String(remember.checked));}catch(_){}if(remember.checked)saveCurrent();};
  refresh().catch(error);
  return {onGame:async()=>{storeButton.disabled=!getGame().loaded;if(remember.checked)await saveCurrent();},refresh};
};
