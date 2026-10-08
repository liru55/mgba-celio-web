/* MPL-2.0. Delta ZIP/info.json compatibility and original Celio frame skins. */
window.createSkins=({m,$,available,onKeys,blocked,action,pulse,onLayout})=>{
  const play=document.querySelector('.play'),viewport=document.querySelector('.screen-viewport'),select=$('skin-select'),status=$('skin-status');
  const art=document.createElement('canvas'),controls=document.createElement('div');art.className='delta-art';controls.className='delta-controls';play.append(art,controls);
  const inputBits={a:0,b:1,select:2,start:3,right:4,left:5,up:6,down:7,r:8,l:9};
  const actions={menu:'menu',quickSave:'save',quickLoad:'load',toggleFastForward:'speed',fastForward:'holdSpeed'};
  let pdfReady;
  function loadPDF(){return pdfReady ||= new Promise((resolve,reject)=>{if(window.pdfjsLib){resolve();return;}const script=document.createElement('script');script.src='vendor/pdf.min.js';script.onload=resolve;script.onerror=()=>reject(Error('PDF表示用ファイルを読み込めません'));document.head.append(script);});}
  let imported=null,mode='dark',representation=null,token=0,activePointers=new Map(),urls=[],imageCache=new Map(),lastOrientation='',applying=false;
  const orient=()=>matchMedia('(orientation:landscape)').matches?'landscape':'portrait';
  const report=text=>status.textContent=text;
  function rect(f){return f&&['x','y','width','height'].every(k=>Number.isFinite(f[k]))&&f.width>0&&f.height>0&&f.width<=16384&&f.height<=16384;}
  function release(){activePointers.clear();onKeys(0);controls.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));action('releaseSpeed');}
  function syncKeys(){let mask=0;for(const p of activePointers.values())mask|=p.mask;onKeys(mask);}
  const safePath=name=>typeof name==='string'&&!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\');
  async function database(){return new Promise((resolve,reject)=>{const q=indexedDB.open('mgba-celio-skins',1);q.onupgradeneeded=()=>q.result.createObjectStore('files');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
  async function store(data){const db=await database();try{await new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite');if(data)t.objectStore('files').put(data,'imported');else t.objectStore('files').delete('imported');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}finally{db.close();}}
  async function read(){const db=await database();try{return await new Promise((resolve,reject)=>{const q=db.transaction('files').objectStore('files').get('imported');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{db.close();}}
  function unpack(bytes){
    if(bytes.length>32*1024*1024)throw Error('スキンは32MB以下にしてください');
    let total=0;
    const files=fflate.unzipSync(bytes,{filter:file=>{if(!safePath(file.name))throw Error('スキン内のファイル名が不正です');total+=file.originalSize;if(total>64*1024*1024||file.originalSize>24*1024*1024)throw Error('展開後のスキンが大きすぎます');return !file.name.endsWith('/');}});
    const infoName=Object.keys(files).find(n=>n==='info.json')||Object.keys(files).find(n=>n.endsWith('/info.json'));
    if(!infoName||files[infoName].length>1024*1024)throw Error('info.jsonが見つかりません');
    const info=JSON.parse(new TextDecoder().decode(files[infoName]));
    if(!['com.rileytestut.delta.game.gba','com.rileytestut.delta.game.gbc'].includes(info.gameTypeIdentifier))throw Error('GBA／GB・GBC用のDeltaスキンを選んでください');
    if(!info.representations||typeof info.representations!=='object')throw Error('スキンの配置情報がありません');
    return {info,files,prefix:infoName.slice(0,-9),bytes};
  }
  function chooseRepresentation(info){
    const kind=innerWidth>=700?'ipad':'iphone',orientation=orient(),reps=info.representations;
    const candidates=[reps[kind]?.[kind==='ipad'?'standard':'edgeToEdge']?.[orientation],reps[kind]?.standard?.[orientation],reps.iphone?.edgeToEdge?.[orientation],reps.iphone?.standard?.[orientation],reps.ipad?.standard?.[orientation]];
    const r=candidates.find(Boolean);if(!r)throw Error('このスキンには'+(orientation==='portrait'?'縦':'横')+'向きの配置がありません');
    const size=r.mappingSize;if(!size||!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<1||size.height<1||size.width>4096||size.height>4096)throw Error('mappingSizeが不正です');
    if(!Array.isArray(r.items)||r.items.length>128)throw Error('ボタン配置が不正です');
    return r;
  }
  async function asset(name,skin){
    if(!safePath(name))throw Error('スキン画像名が不正です');
    const key=skin.prefix+name;if(imageCache.has(key))return imageCache.get(key);
    const bytes=skin.files[key]||skin.files[name];if(!bytes)throw Error('画像がありません：'+name);
    let result;
    if(/\.pdf$/i.test(name)){
      await loadPDF();
      pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';
      const task=pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false,disableFontFace:true,useSystemFonts:true});
      const pdf=await task.promise;try{const page=await pdf.getPage(1),size=page.getViewport({scale:1}),scale=Math.min(3,1600/Math.max(size.width,size.height)),view=page.getViewport({scale});result=document.createElement('canvas');result.width=Math.max(1,Math.ceil(view.width));result.height=Math.max(1,Math.ceil(view.height));await page.render({canvasContext:result.getContext('2d'),viewport:view,background:'rgba(0,0,0,0)'}).promise;}finally{await pdf.destroy();}
    }else{
      const mime=/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':null;if(!mime)throw Error('PDF・PNG・JPEG・WebP画像に対応しています');
      const url=URL.createObjectURL(new Blob([bytes],{type:mime}));urls.push(url);result=new Image();result.src=url;await result.decode();if(result.width>8192||result.height>8192)throw Error('画像サイズが大きすぎます');
    }
    imageCache.set(key,result);return result;
  }
  function item(inputs,x,y,w,h){return {inputs,frame:{x,y,width:w,height:h}};}
  function frameRepresentation(type,orientation){
    const landscape=orientation==='landscape',width=landscape?800:414,height=landscape?360:650;
    const screen=landscape?{x:210,y:46,width:380,height:253}:{x:35,y:62,width:344,height:type==='gb-frame'?309:229};
    const dy=type==='gb-frame'?410:377;
    const items=landscape?[item({up:'up',down:'down',left:'left',right:'right'},33,140,140,140),item(['a'],693,138,62,62),item(['b'],620,191,62,62),item(['l'],29,30,130,42),item(['r'],641,30,130,42),item(['select'],294,309,78,28),item(['start'],430,309,78,28),item(['menu'],16,303,64,32)]:[item({up:'up',down:'down',left:'left',right:'right'},30,dy,142,142),item(['a'],315,dy+12,64,64),item(['b'],235,dy+56,64,64),item(['l'],25,15,112,34),item(['r'],277,15,112,34),item(['select'],120,575,72,30),item(['start'],220,575,72,30),item(['menu'],16,603,60,30)];
    return {mappingSize:{width,height},gameScreenFrame:screen,items,assets:{},extendedEdges:{top:8,bottom:8,left:5,right:5},_builtin:type};
  }
  function drawFrame(r){
    const {width:w,height:h}=r.mappingSize,c=document.createElement('canvas');c.width=w*2;c.height=h*2;const ctx=c.getContext('2d'),round=(...args)=>ctx.roundRect?ctx.roundRect(...args):ctx.rect(...args.slice(0,4));ctx.scale(2,2);ctx.fillStyle=r._builtin==='gb-frame'?'#c7c9ba':'#514c88';ctx.fillRect(0,0,w,h);
    const f=r.gameScreenFrame;ctx.fillStyle='#292d32';ctx.beginPath();round(f.x-13,f.y-16,f.width+26,f.height+38,16);ctx.fill();ctx.fillStyle='#090c10';ctx.fillRect(f.x,f.y,f.width,f.height);ctx.font='bold 12px system-ui';ctx.fillStyle='#abb7c4';ctx.fillText('CELIO  •  '+(r._builtin==='gb-frame'?'POCKET':'ADVANCE'),f.x,f.y+f.height+17);
    for(const it of r.items){const f=it.frame,dir=!Array.isArray(it.inputs),label=dir?'':it.inputs[0].toUpperCase();ctx.fillStyle=dir?'#222930':label==='A'||label==='B'?(r._builtin==='gb-frame'?'#87394f':'#29313b'):'#363c43';ctx.beginPath();if(dir){const x=f.x,y=f.y,s=f.width/3;ctx.moveTo(x+s,y);ctx.lineTo(x+2*s,y);ctx.lineTo(x+2*s,y+s);ctx.lineTo(x+3*s,y+s);ctx.lineTo(x+3*s,y+2*s);ctx.lineTo(x+2*s,y+2*s);ctx.lineTo(x+2*s,y+3*s);ctx.lineTo(x+s,y+3*s);ctx.lineTo(x+s,y+2*s);ctx.lineTo(x,y+2*s);ctx.lineTo(x,y+s);ctx.lineTo(x+s,y+s);ctx.closePath();}else round(f.x,f.y,f.width,f.height,['A','B'].includes(label)?f.width/2:8);ctx.fill();if(label){ctx.fillStyle='#f1f4f7';ctx.font=(label.length>2?'10':'bold 22')+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,f.x+f.width/2,f.y+f.height/2);}}
    return c;
  }
  async function artwork(r,skin){
    if(r._builtin)return drawFrame(r);
    const c=document.createElement('canvas'),s=r.mappingSize;c.width=Math.ceil(s.width*2);c.height=Math.ceil(s.height*2);const ctx=c.getContext('2d');ctx.scale(2,2);
    const assets=r.assets||{},name=assets.resizable||assets.large||assets.medium||assets.small;if(name)ctx.drawImage(await asset(name,skin),0,0,s.width,s.height);
    for(const it of r.items){const a=it.asset||it.thumbstick;if(a){const name=a.name||a.normal;if(name&&rect(it.frame)){const f=it.frame,w=a.width||f.width,h=a.height||f.height;ctx.drawImage(await asset(name,skin),f.x+(f.width-w)/2,f.y+(f.height-h)/2,w,h);}}}
    return c;
  }
  function screenFrame(r){if(rect(r.gameScreenFrame))return r.gameScreenFrame;const s=r.screens?.[0];if(s&&rect(s.outputFrame)){const f=s.outputFrame;if(s.placement==='app')return {x:f.x*r.mappingSize.width,y:f.y*r.mappingSize.height,width:f.width*r.mappingSize.width,height:f.height*r.mappingSize.height};return f;}return null;}
  function place(){
    if(!representation||!play.classList.contains('delta-skin')||applying)return;applying=true;
    try{
      const r=representation,size=r.mappingSize,toolbar=play.querySelector('.emulator-toolbar').getBoundingClientRect().height,w=play.clientWidth,fullscreen=play.classList.contains('immersive'),sf=screenFrame(r),gameAspect=$('screen').width/$('screen').height||1.5;
      let areaWidth=w,areaHeight=w*size.height/size.width,top=0,left=0;
      const paddingTop=fullscreen?48:0;
      if(fullscreen){const availableHeight=Math.max(80,play.clientHeight-toolbar-paddingTop);if(sf){areaWidth=Math.min(w,availableHeight*size.width/size.height);areaHeight=areaWidth*size.height/size.width;top=paddingTop+(availableHeight-areaHeight)/2;left=(w-areaWidth)/2;}else{areaHeight=Math.min(areaHeight,availableHeight*.48);areaWidth=areaHeight*size.width/size.height;left=(w-areaWidth)/2;top=paddingTop+availableHeight-areaHeight;}}
      else{const screenHeight=sf?0:w/gameAspect;top=screenHeight;play.style.setProperty('--skin-height',(screenHeight+areaHeight)+'px');}
      for(const el of [art,controls]){el.style.left=left+'px';el.style.top=top+'px';el.style.width=areaWidth+'px';el.style.height=areaHeight+'px';}
      let f;
      if(sf)f={x:left+sf.x/size.width*areaWidth,y:top+sf.y/size.height*areaHeight,width:sf.width/size.width*areaWidth,height:sf.height/size.height*areaHeight};
      else f={x:0,y:paddingTop,width:w,height:fullscreen?Math.max(1,top-paddingTop):top};
      Object.assign(viewport.style,{left:f.x+'px',top:f.y+'px',width:f.width+'px',height:f.height+'px'});
    }finally{applying=false;}
  }
  function makeControls(r){
    controls.replaceChildren();const size=r.mappingSize;
    for(const it of r.items){if(!rect(it.frame))continue;const inputs=it.inputs,dir=!Array.isArray(inputs)&&inputs&&['up','down','left','right'].every(k=>typeof inputs[k]==='string');if(!dir&&!Array.isArray(inputs))continue;
      const f=it.frame,edges={...(r.extendedEdges||{}),...(it.extendedEdges||{})},e=k=>Number.isFinite(edges[k])?Math.max(0,Math.min(100,edges[k])):0,button=document.createElement('button');button.className='delta-hit';button.type='button';button.setAttribute('aria-label',dir?'方向キー':inputs.join(' + '));Object.assign(button.style,{left:(f.x-e('left'))/size.width*100+'%',top:(f.y-e('top'))/size.height*100+'%',width:(f.width+e('left')+e('right'))/size.width*100+'%',height:(f.height+e('top')+e('bottom'))/size.height*100+'%'});
      function maskFor(event){if(!dir)return inputs.reduce((mask,k)=>mask|(k in inputBits?1<<inputBits[k]:0),0);const b=controls.getBoundingClientRect(),x=(event.clientX-b.left)/b.width*size.width,y=(event.clientY-b.top)/b.height*size.height,nx=(x-f.x)/f.width,ny=(y-f.y)/f.height;if(nx<-.25||nx>1.25||ny<-.25||ny>1.25)return 0;const chosen=[];if(nx<1/3)chosen.push(inputs.left);else if(nx>2/3)chosen.push(inputs.right);if(ny<1/3)chosen.push(inputs.up);else if(ny>2/3)chosen.push(inputs.down);return chosen.reduce((mask,k)=>mask|(k in inputBits?1<<inputBits[k]:0),0);}
      button.onpointerdown=event=>{if(blocked()||button.disabled)return;event.preventDefault();event.stopPropagation();button.setPointerCapture(event.pointerId);const mask=maskFor(event);activePointers.set(event.pointerId,{mask,button});syncKeys();button.classList.add('pressed');pulse();if(!dir)for(const k of inputs)if(actions[k])action(actions[k]);};
      button.onpointermove=event=>{const p=activePointers.get(event.pointerId);if(!p||!dir)return;event.preventDefault();const mask=maskFor(event);if(mask&&mask!==p.mask)pulse();p.mask=mask;syncKeys();};
      const end=event=>{activePointers.delete(event.pointerId);syncKeys();button.classList.remove('pressed');if(Array.isArray(inputs)&&inputs.includes('fastForward'))action('releaseSpeed');};button.onpointerup=button.onpointercancel=button.onlostpointercapture=end;button.onclick=e=>e.preventDefault();controls.append(button);
    }
  }
  async function apply(){
    const ticket=++token;release();$('skin-export').disabled=true;play.classList.remove('delta-skin');representation=null;viewport.removeAttribute('style');art.hidden=controls.hidden=true;document.documentElement.dataset.skin=mode;
    if(!['gba-frame','gb-frame','delta'].includes(mode)){$('skin-export').disabled=true;onLayout();return;}
    try{
      if(mode==='delta'&&!imported)throw Error('先にDeltaスキンを読み込んでください');
      if(mode==='delta'&&available()){const gba=m._web_platform()===0;if(gba!==imported.info.gameTypeIdentifier.endsWith('.gba'))throw Error('ROMとスキンのゲーム機種が異なります');}
      const r=mode==='delta'?chooseRepresentation(imported.info):frameRepresentation(mode,orient()),image=await artwork(r,imported);if(ticket!==token)return;
      art.width=image.width;art.height=image.height;art.getContext('2d').drawImage(image,0,0);representation=r;makeControls(r);art.hidden=controls.hidden=false;play.classList.add('delta-skin');lastOrientation=orient();place();$('skin-export').disabled=false;onLayout();
      report((mode==='delta'?imported.info.name||'Deltaスキン':mode==='gba-frame'?'GBA本体風':'GB本体風')+'を適用しました。スキン使用中はファイルの配置を使います。');
    }catch(e){if(ticket===token){play.classList.remove('delta-skin');onLayout();report(e.message+'。標準の操作ボタンを表示します。');}}
  }
  async function setMode(value){mode=value;select.value=mode;if(['gba-frame','gb-frame','delta'].includes(mode)&&$('touch-visible')&&!$('touch-visible').checked){$('touch-visible').checked=true;$('touch-visible').dispatchEvent(new Event('change'));}try{localStorage.setItem('mgba-skin',mode);}catch(_){}await apply();}
  select.onchange=()=>setMode(select.value);
  $('skin-import').onclick=()=>$('skin-file').click();$('skin-file').onchange=async()=>{const file=$('skin-file').files[0];if(!file)return;try{report('スキンを読み込み中…');const next=unpack(new Uint8Array(await file.arrayBuffer()));chooseRepresentation(next.info);imageCache.clear();for(const url of urls)URL.revokeObjectURL(url);urls=[];imported=next;await store(next.bytes);$('skin-remove').disabled=false;await setMode('delta');}catch(e){report('読み込めませんでした：'+e.message);}finally{$('skin-file').value='';}};
  $('skin-remove').onclick=async()=>{try{await store(null);imported=null;imageCache.clear();for(const url of urls)URL.revokeObjectURL(url);urls=[];$('skin-remove').disabled=true;await setMode('dark');report('読み込んだスキンを削除しました。');}catch(e){report(e.message);}};
  $('skin-export').onclick=async()=>{try{let bytes,name;if(mode==='delta'){bytes=imported.bytes;name=(imported.info.name||'skin')+'.deltaskin';}else{const portrait=frameRepresentation(mode,'portrait'),landscape=frameRepresentation(mode,'landscape'),files={};for(const [o,r] of [['portrait',portrait],['landscape',landscape]]){const blob=await new Promise(resolve=>drawFrame(r).toBlob(resolve,'image/png'));files[o+'.png']=new Uint8Array(await blob.arrayBuffer());delete r._builtin;r.assets={small:o+'.png',medium:o+'.png',large:o+'.png'};}const game=available()?(m._web_platform()===0?'gba':'gbc'):(mode==='gba-frame'?'gba':'gbc'),info={name:mode==='gba-frame'?'Celio Advance':'Celio Pocket',identifier:'io.github.liru55.celio.'+mode+'.'+game,gameTypeIdentifier:'com.rileytestut.delta.game.'+game,representations:{iphone:{standard:{portrait,landscape},edgeToEdge:{portrait,landscape}},ipad:{standard:{portrait,landscape}}}};files['info.json']=new TextEncoder().encode(JSON.stringify(info,null,2));bytes=fflate.zipSync(files);name=info.name+'.deltaskin';}const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){report('書き出せませんでした：'+e.message);}};
  function suppressSkin(){
    if(!representation)return;
    const hidden=document.body.classList.contains('clean-view')||play.classList.contains('touch-hidden')||play.classList.contains('no-touch');
    play.classList.toggle('delta-skin',!hidden);art.hidden=controls.hidden=hidden;
    if(hidden){release();viewport.removeAttribute('style');}else place();
  }
  const classObserver=new MutationObserver(()=>suppressSkin());
  classObserver.observe(play,{attributes:true,attributeFilter:['class']});classObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  new ResizeObserver(()=>requestAnimationFrame(place)).observe(play);addEventListener('resize',()=>{if(orient()!==lastOrientation&&representation)apply();else place();});
  addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  play.addEventListener('pointerdown',()=>{if(blocked())release();},{capture:true});
  try{mode=localStorage.getItem('mgba-skin')||'dark';}catch(_){}if(![...select.options].some(o=>o.value===mode))mode='dark';select.value=mode;
  read().then(async bytes=>{if(bytes){imported=unpack(new Uint8Array(bytes));$('skin-remove').disabled=false;}await apply();}).catch(()=>{if(mode==='delta')setMode('dark');});
  return {release,onGame:()=>apply(),active:()=>!!representation};
};
