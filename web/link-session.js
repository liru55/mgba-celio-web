/* MPL-2.0. Browser transport for upstream CelioNet, rom64 dee555365.
 * ROMs and save files stay local; only Celio cable packets are relayed. */
window.createLinkSession=function(api){
  const {m,$,upload,store}=api, supported=typeof m._web_celio_start==='function';
  let busy=false,starting=false,ending=false,online=false,view=0,game,backup,stateBefore,secondary,savedSecondary;
  let ws,timer,clock=0,sequence=0,expected=0,lastReceive=0,generation=0,blockSave=false;
  let joined=false,room='',seen=new Set(),pending=new Map(),closed=false;
  const statuses=[0,0], say=t=>{$('link-status').textContent=t;$('link-hud-status').textContent=t;};
  function bytes(kind){const n=m[kind==='state'?'_web_state_export':'_web_save_export'](),p=m[kind==='state'?'_web_state_data':'_web_save_data']();return n?m.HEAPU8.slice(p,p+n):null;}
  function buttons(){
    const available=supported&&api.getGame().loaded&&m._web_platform()===0&&!busy&&!starting&&!ending;
    for(const id of ['link-host','link-join','link-local-start'])$(id).disabled=!available;
    for(const id of ['link-pick-save2','link-blank2','link-room','link-server'])$(id).disabled=busy||starting||ending;
    $('link-end').disabled=!busy||starting||ending;$('link-backup').disabled=!backup;
    $('link-export2').disabled=!(secondary||savedSecondary)||busy&&online;
    $('link-hud').hidden=!busy;$('link-view0').hidden=$('link-view1').hidden=online;
    $('link-view0').setAttribute('aria-pressed',String(view===0));$('link-view1').setAttribute('aria-pressed',String(view===1));
  }
  function select(i){m._web_select(i);view=i;api.release();api.refresh();buttons();}
  function download(data,suffix){if(!data)return;const url=URL.createObjectURL(new Blob([data])),a=document.createElement('a');a.href=url;a.download=(game?.name||'game').replace(/\.[^.]+$/,'')+suffix+'.sav';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  async function begin(isOnline){
    if(busy||starting||ending)throw new Error('通信を終了してから操作してください');
    const info=api.getGame();if(!supported||!info.loaded||m._web_platform()!==0)throw new Error('GBAのROMを開いてから使ってください');
    if(info.cheats)throw new Error('チートを削除してから通信してください');
    starting=true;buttons();
    try{
      game=info;await api.beforeStart();m._web_select(0);backup=bytes('save');stateBefore=bytes('state');
      if(!stateBefore)throw new Error('通信前のバックアップを作れませんでした');
      if(backup)await store.write('link-backup:'+game.key,{bytes:backup.buffer,updated:Date.now(),filename:game.name});
      if(!m._web_celio_start(0))throw new Error('通信デバイスを開始できませんでした');
      online=isOnline;busy=true;blockSave=true;view=0;clock=0;closed=false;generation++;
      sequence=expected=0;joined=false;seen.clear();pending.clear();statuses.fill(0);api.mode(true,true);api.close();
    }finally{starting=false;buttons();}
  }
  async function finish(keep,message,notify=true){
    if(!busy||ending)return;ending=true;busy=false;generation++;clearTimeout(timer);timer=null;
    const socket=ws;ws=null;if(socket){if(notify&&socket.readyState===1)socket.send('42["sessionLeft"]');socket.close();}
    m._web_celio_stop(0);m._web_celio_stop(1);
    if(!online){m._web_select(1);savedSecondary=bytes('save');m._web_close();}
    m._web_select(0);if(!keep&&stateBefore)upload(stateBefore,m._web_state_import);
    const data=keep?bytes('save'):backup;
    try{
      if(keep&&!online&&savedSecondary)await store.write('link2:'+game.key,{bytes:savedSecondary.buffer,updated:Date.now(),filename:game.name});
      if(data)await store.write(game.key,{bytes:data.buffer,updated:Date.now(),filename:game.name});
    }catch(_){message+='。保存に失敗しました。セーブをファイルに書き出してください';}
    room='';joined=false;sequence=expected=0;seen.clear();pending.clear();$('link-room').value='';
    blockSave=!keep;ending=false;api.release();if(keep)api.close();
    api.mode(false,keep&&!document.hidden);api.refresh();say(message);buttons();
  }
  const fail=e=>finish(false,(e.message||String(e))+'。通信前の状態に戻しました',false);
  function command(slot,value){if(!m._web_celio_command(slot,value))throw new Error('通信コマンドを処理できませんでした');}
  function receive(slot,data){
    if(!Array.isArray(data)||data.length!==32||data.some(v=>!Number.isInteger(v)||v<0||v>65535))throw new Error('不正な通信データです');
    const values=new Uint16Array(data);if(!upload(new Uint8Array(values.buffer),(p,n)=>m._web_celio_receive(slot,p,n/2)))throw new Error('通信が混み合っています');
  }
  function sendEvent(event,value){if(!ws||ws.readyState!==1)throw new Error('サーバーとの接続が切れました');if(ws.bufferedAmount>1024*1024)throw new Error('通信が追いつきませんでした');ws.send('42'+JSON.stringify([event,value]));}
  function poll(slot){
    let p,count=0;while((p=m._web_celio_poll(slot))&&count++<512){
      const values=new Uint16Array(m.HEAPU8.buffer,p,34),type=values[0],value=values[1];
      if(type===2){const data=Array.from(values.subarray(2,2+value));if(online){if(joined)sendEvent('deviceData',{sequence:sequence++,data});}else receive(1-slot,data);}
      else if(type===1){
        if(value===0xFF05)say(online?'部屋 '+room+'：ケーブル通信中':'端末内でケーブル通信中（1P／2Pで切替）');
        if(value===0xFF07)closed=true;
        if(online){if(joined&&![0xFF08,0xFF09,0xFFFF].includes(value))sendEvent('deviceStatus',{uuid:crypto.randomUUID(),linkStatus:value});}
        else{
          if(value===0xFF02)command(slot,slot===0?0x10:0x11);
          if(value===0xFF03){statuses[slot]=value;if(statuses.every(v=>v===value)){command(0,0x12);command(1,0x12);}}
          if(value===0xFF05)command(1-slot,0x13);
        }
      }
    }
  }
  function startMode(){m._web_celio_reset(0);sequence=expected=0;pending.clear();seen.clear();command(0,1);const ticket=generation;clearTimeout(timer);timer=setTimeout(()=>{if(busy&&ticket===generation){try{command(0,0);poll(0);}catch(e){fail(e);}}},500);}
  function deliver(packet){
    if(!packet||!Number.isSafeInteger(packet.sequence)||packet.sequence<0)throw new Error('不正な通信番号です');
    if(!Array.isArray(packet.data)||packet.data.length!==32||packet.data.some(v=>!Number.isInteger(v)||v<0||v>65535))throw new Error('不正な通信データです');
    const seq=packet.sequence;if(seq<expected)return;
    if(seq>expected){if(seq-expected>1024||pending.size>=1024)throw new Error('通信の順序を復元できませんでした');pending.set(seq,packet.data);return;}
    receive(0,packet.data);expected++;while(pending.has(expected)){receive(0,pending.get(expected));pending.delete(expected++);}
  }
  function message(raw){
    if(typeof raw!=='string'||raw.length>65536)throw new Error('通信メッセージが大きすぎます');lastReceive=performance.now();
    if(raw[0]==='0'){ws.send('40'+JSON.stringify({clientId:crypto.randomUUID()}));return;}
    if(raw[0]==='2'){ws.send('3');return;}if(raw[0]==='1')throw new Error('接続が終了しました');
    const match=/^4([0-4])(\d*)(.*)$/s.exec(raw);if(!match)return;
    const type=match[1],id=match[2]===''?-1:Number(match[2]);
    if(type==='0'){ws.send('420'+JSON.stringify(room?['sessionJoin',room]:['sessionCreate',null]));return;}
    if(type==='4'||type==='1')throw new Error('サーバーに接続できませんでした');if(!['2','3'].includes(type))return;
    const args=JSON.parse(match[3]);
    if(type==='3'){
      if(id!==0)return;const reply=args[0];
      if(reply?.variant!=='Ok')throw new Error(reply?.error==='Session not found'?'その番号の部屋はありません':reply?.error==='Session is full'?'その部屋は満員です':'部屋に入れませんでした');
      const number=reply.value?.id||reply.id;
      if(typeof number!=='string'||!/^\d{4}$/.test(number))throw new Error('部屋番号を確認できませんでした');
      const guest=!!room;room=number;$('link-room').value=room;joined=true;
      say('部屋 '+room+'：'+(guest?'ゲーム内のケーブル交換受付へ進んでください':'相手にこの番号を伝えてください'));if(guest)startMode();return;
    }
    if(!Array.isArray(args))throw new Error('不正な通信イベントです');const [event,data]=args;
    if(event==='deviceData'){deliver(data);if(id>=0)ws.send('43'+id+'[true]');}
    else if(event==='deviceCommand'){
      if(!data||!Number.isInteger(data.command)||![0,1,0x10,0x11,0x12,0x13,0xFF0A].includes(data.command))throw new Error('不正な通信コマンドです');
      if(data.uuid&&seen.has(data.uuid))return;if(seen.size>4096)throw new Error('通信コマンドが多すぎます');if(data.uuid)seen.add(data.uuid);command(0,data.command);
    }else if(event==='partnerJoined'){say('部屋 '+room+'：相手が参加しました。ケーブル交換受付へ進んでください');startMode();}
    else if(event==='partnerLeft')fail(new Error('相手が部屋を離れました'));
    else if(event==='sessionClose')finish(closed,closed?'通信が完了し、セーブを保存しました':'通信が終了したため、通信前の状態に戻しました',false);
  }
  async function startOnline(guest){
    try{
      const number=$('link-room').value.trim();if(guest&&!/^\d{4}$/.test(number))throw new Error('4桁の部屋番号を入力してください');
      const server=new URL($('link-server').value.trim()||'https://celio-server.up.railway.app');
      if(!['https:','http:','wss:','ws:'].includes(server.protocol)||server.username||server.password)throw new Error('中継サーバーのURLを確認してください');
      if(location.protocol==='https:'&&!['https:','wss:'].includes(server.protocol))throw new Error('httpsまたはwssのサーバーを指定してください');
      server.protocol=['https:','wss:'].includes(server.protocol)?'wss:':'ws:';server.pathname=server.pathname.replace(/\/$/,'')+'/socket.io/';server.search='?EIO=4&transport=websocket';server.hash='';
      await begin(true);room=guest?number:'';say('Celioの中継サーバーへ接続中…');lastReceive=performance.now();
      const socket=ws=new WebSocket(server.href),ticket=generation;
      socket.onmessage=e=>{if(ticket===generation&&busy){try{message(e.data);}catch(err){fail(err);}}};
      socket.onerror=()=>{if(ticket===generation&&busy)fail(new Error('Celioサーバーに接続できませんでした'));};
      socket.onclose=()=>{if(ticket===generation&&busy)fail(new Error('通信接続が切れました'));};
    }catch(e){if(busy)await fail(e);else say(e.message);}
  }
  $('link-host').onclick=()=>startOnline(false);$('link-join').onclick=()=>startOnline(true);
  $('link-local-start').onclick=async()=>{
    try{
      if(!secondary&&!$('link-blank2').checked)throw new Error('2人目のセーブを選ぶか「最初から」をオンにしてください');
      await begin(false);m._web_select(1);if(!upload(game.bytes,m._web_load))throw new Error('2人目のROMを開けませんでした');
      if(secondary&&!$('link-blank2').checked&&!upload(secondary,m._web_save_import))throw new Error('2人目のセーブを読み込めませんでした');
      if(!m._web_celio_start(1))throw new Error('2人目の通信デバイスを開始できませんでした');
      command(0,0);command(1,0);select(0);say('端末内で接続しました。1P／2Pの両方でケーブル交換受付へ進んでください');
    }catch(e){if(busy)await fail(e);else say(e.message);}
  };
  $('link-pick-save2').onclick=()=>$('link-save2').click();
  $('link-save2').onchange=async()=>{const f=$('link-save2').files[0];if(!f)return;if(f.size>1024*1024){say('セーブは1MB以下を選んでください');return;}secondary=new Uint8Array(await f.arrayBuffer());$('link-save2-name').textContent=f.name;$('link-blank2').checked=false;$('link-save2').value='';buttons();};
  $('link-end').onclick=()=>finish(true,'通信を終了し、セーブを保存しました');$('link-backup').onclick=()=>download(backup,'-通信前');
  $('link-export2').onclick=()=>{if(busy&&!online){m._web_select(1);savedSecondary=bytes('save');m._web_select(view);}download(savedSecondary||secondary,'-2P');};
  $('link-view0').onclick=()=>select(0);$('link-view1').onclick=()=>select(1);$('link-open').onclick=$('link-hud-settings').onclick=api.open;
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&busy)fail(new Error('画面を閉じたため通信を終了しました'));});
  window.addEventListener('pagehide',()=>{if(busy)fail(new Error('ページを閉じたため通信を終了しました'));});buttons();
  return{
    get busy(){return busy||ending;},get blockSave(){return blockSave;},
    async onGame(){blockSave=false;backup=stateBefore=secondary=savedSecondary=null;$('link-save2-name').textContent='2人目のセーブは未選択';const info=api.getGame(),cached=await store.read('link2:'+info.key);if(cached?.bytes){secondary=new Uint8Array(cached.bytes);$('link-save2-name').textContent='このブラウザに保存した2人目のセーブ';}buttons();say(supported?'通信方法を選んでください':'更新したページを読み込み直してください');},
    tick(now,keys){
      if(!busy)return false;
      try{
        if(online&&now-lastReceive>20000)throw new Error('サーバーから応答がありません');
        const step=1000/m._web_fps();if(!clock)clock=now;let count=0;
        while(now>=clock&&count++<4){if(online){m._web_select(0);m._web_frame(keys);poll(0);}else for(let slot=0;slot<2;slot++){m._web_select(slot);m._web_frame(slot===view?keys:0);poll(slot);}m._web_select(view);api.audio();clock+=step;}
        if(now-clock>step*4)clock=now;m._web_select(view);return count>0;
      }catch(e){fail(e);return false;}
    }
  };
};
