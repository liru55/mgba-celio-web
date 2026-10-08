const {webkit, devices}=require('playwright');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../build-web');
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if(!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  const types={'.css':'text/css','.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.png':'image/png','.webmanifest':'application/manifest+json'};
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await webkit.launch({headless:true});
 try {
 const context=await browser.newContext({...devices['iPhone 13']});
 await context.addInitScript(()=>{
   window.__rates=[];window.__gain=1;
   class TestAudioContext {
     constructor(){this.state='suspended';this.sampleRate=48000;this.destination={};}
     get currentTime(){return performance.now()/1000;}
     async resume(){this.state='running';}
     createGain(){return {connect(){},gain:{value:1,setTargetAtTime(value){window.__gain=value}}};}
     createBuffer(channels,count){const arrays=Array.from({length:channels},()=>new Float32Array(count));return {getChannelData(i){return arrays[i]}};}
     createBufferSource(){return {playbackRate:{value:1},connect(){},start(){window.__rates.push(this.playbackRate.value);setTimeout(()=>this.onended?.(),5)},stop(){this.onended?.()}};}
   }
   window.AudioContext=TestAudioContext;
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!document.getElementById('open').disabled);await page.locator('#open').click();
 const rom=Buffer.alloc(32768);rom.set([0xc3,0x50,0x01],0x100);rom.set([0xce,0xed,0x66,0x66],0x104);rom.set([0x18,0xfe],0x150);rom[0x147]=3;rom[0x149]=2;
 await page.locator('#rom').setInputFiles({name:'audio.gb',mimeType:'application/octet-stream',buffer:rom});await page.waitForFunction(()=>window.__rates.includes(1));
 for(const speed of ['1.5','2','3','4']){
  await page.locator('#settings-open').click();await page.locator('#tab-display').click();await page.locator('#game-speed').selectOption(speed);await page.locator('#settings-close').click();await page.waitForFunction(rate=>window.__rates.includes(rate),Number(speed));assert.equal(await page.evaluate(()=>window.__gain),1);
 }
 await page.locator('#speed-toggle').click();assert.equal(await page.locator('#speed-toggle').textContent(),'倍速 OFF');await page.locator('#speed-toggle').click();assert.equal(await page.locator('#speed-toggle').textContent(),'倍速 4×');assert.deepEqual(errors,[]);
 console.log('Audio scheduling at 1/1.5/2/3/4x with unmuted gain, fast-speed toggle restore PASS (instrumented audio output)');
 await context.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
