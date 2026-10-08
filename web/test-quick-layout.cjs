const {webkit,devices,chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../build-web');
const server=http.createServer((req,res)=>{const f=path.join(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',f.endsWith('.wasm')?'application/wasm':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(b);});});
const rom=Buffer.alloc(32768);rom.set([0xfe,0xff,0xff,0xea]);rom[0xb2]=0x96;rom.write('FLASH1M_V',0x100);
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await (process.env.CELIO_ONLINE?chromium:webkit).launch();try{
const contexts=await Promise.all([browser.newContext({...devices['iPhone 13']}),browser.newContext({...devices['iPhone 13']})]);
const pages=await Promise.all(contexts.map(c=>c.newPage())),errors=[];
for(const p of pages){p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>{let create;Object.defineProperty(window,'createMGBA',{get:()=>create,set:f=>{create=async(...args)=>{const m=window.__m=await f(...args);window.__incoming=[];const receive=m._web_celio_receive;m._web_celio_receive=(slot,p,n)=>{window.__incoming.push(Array.from(new Uint16Array(m.HEAPU8.buffer,p,n)));return receive(slot,p,n);};return m;};}});});await p.goto(process.env.PUBLIC_URL||`http://127.0.0.1:${server.address().port}/`);await p.waitForFunction(()=>!document.getElementById('open').disabled);await p.locator('#rom').setInputFiles({name:'celio.gba',mimeType:'application/octet-stream',buffer:rom});await p.waitForFunction(()=>document.querySelector('.play.has-rom'));}
const p=pages[0];
if(!process.env.CELIO_ONLINE){
 await p.locator('#fullscreen').click();await p.locator('#fullscreen-layout').click();await p.locator('#pad-edit').click();
 const positions={};
 for(const [id,x,y] of [['quick-action-speed',90,260],['quick-action-save',280,400],['quick-action-load',190,550]]){
  const other=await p.locator('#quick-action-save').boundingBox(),b=await p.locator('#'+id).boundingBox();assert.ok(b);await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(x,y,{steps:6});await p.mouse.up();positions[id]=await p.evaluate(id=>JSON.parse(localStorage.getItem('mgba-touch-layout')).positions[id],id);
  assert.ok(positions[id]);if(id==='quick-action-speed')assert.deepEqual(await p.locator('#quick-action-save').boundingBox(),other);
 }
 assert.equal(await p.locator('#speed-toggle').textContent(),'倍速 OFF');
 await p.locator('#edit-done').click();await p.locator('#settings-close').click();await p.locator('#speed-toggle').click();assert.match(await p.locator('#speed-toggle').textContent(),/2×/);await p.locator('#speed-toggle').click();
 await p.locator('#quick-state-save').click();await p.waitForFunction(()=>!document.getElementById('quick-state-load').disabled);await p.locator('#quick-state-load').click();
 await p.setViewportSize({width:844,height:390});await p.locator('#fullscreen-layout').click();await p.locator('#pad-edit').click();const b=await p.locator('#quick-action-load').boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(650,250,{steps:6});await p.mouse.up();
 const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('mgba-touch-layout')));for(const id of Object.keys(positions))assert.deepEqual(saved.positions[id],positions[id]);assert.ok(saved.landscapePositions['quick-action-load']);
 await p.locator('#edit-done').click();await p.locator('#settings-close').click();await p.locator('#fullscreen-exit').click();
 await p.locator('#link-open').click();await p.locator('#link-blank2').check();await p.locator('#link-local-start').click();await p.waitForFunction(()=>document.body.classList.contains('link-mode'));assert.equal(await p.locator('#link-view1').isVisible(),true);await p.locator('#link-view1').click();assert.equal(await p.evaluate(()=>window.__m._web_selected()),1);await p.locator('#link-hud-settings').click();await p.locator('#link-end').click();await p.waitForFunction(()=>!document.body.classList.contains('link-mode'));assert.match(await p.locator('#link-status').textContent(),/保存しました/);
 console.log('Independent quick action placement, orientation persistence, fullscreen unified editor, actual quick save/load, local Celio UI PASS');
}else{
 const [host,guest]=pages;await host.locator('#link-open').click();await host.locator('#link-host').click();await host.waitForFunction(()=>/^\d{4}$/.test(document.getElementById('link-room').value),{},{timeout:30000});const room=await host.locator('#link-room').inputValue();
 await guest.locator('#link-open').click();await guest.locator('#link-room').fill(room);await guest.locator('#link-join').click();
 for(const page of pages)await page.waitForFunction(()=>[0x601F,0x600B].includes(window.__m._web_bus_read16(0x04000128)),{},{timeout:30000});
 for(const page of pages)await page.evaluate(()=>{const m=window.__m;m._web_bus_write16(0x04000134,0);m._web_bus_write16(0x04000128,0x2003);m._web_bus_write16(0x0400012a,0xB9A0);m._web_bus_read16(0x04000122);});
 await host.waitForTimeout(1200);
 await host.evaluate(()=>{const m=window.__m;m._web_bus_write16(0x0400012a,0x8FFF);m._web_bus_read16(0x04000122);});await host.waitForTimeout(600);
 await guest.evaluate(()=>window.__m._web_bus_read16(0x04000122));await guest.waitForTimeout(300);
 await host.evaluate(()=>{const m=window.__m;m._web_bus_write16(0x0400012a,0xCAFE);for(let i=0;i<40;i++)m._web_bus_read16(0x04000122);});
 await guest.waitForFunction(()=>window.__incoming.some(a=>a.length===32&&a.includes(0xCAFE)),{},{timeout:15000});
 await host.locator('#link-hud-settings').click();await host.locator('#link-end').click();await Promise.all(pages.map(page=>page.waitForFunction(()=>!document.body.classList.contains('link-mode'))));
 console.log('Public Celio relay: real 4-digit room, two independent clients, master/slave handshake, 32-word cable packet transfer, disconnect restoration PASS');
}
assert.deepEqual(errors,[]);await Promise.all(contexts.map(c=>c.close()));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
