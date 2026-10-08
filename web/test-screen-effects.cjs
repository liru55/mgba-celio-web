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
 try{
 const context=await browser.newContext({viewport:{width:400,height:400}}),page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/help.html`);
 await page.setContent(`<div class="play" style="position:relative;width:128px;height:128px"><canvas id="fixture" width="4" height="4" style="width:128px;height:128px"></canvas></div><select id="screen-effect"><option value="off">通常</option><option value="xbrz">xBRZ</option></select><input id="effect-strength"><output id="effect-strength-value"></output><p id="effect-status"></p><input id="screen-scale"><button id="screen-fit"></button>`);
 await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/screen-effects.js`});
 await page.evaluate(()=>{const source=document.getElementById('fixture');window.fixture=new ImageData(4,4);for(let y=0;y<4;y++)for(let x=0;x<4;x++){const p=(y*4+x)*4;for(let c=0;c<3;c++)fixture.data[p+c]=x<=y?255:0;fixture.data[p+3]=255;}window.effects=createScreenEffects(source);effects.render(fixture);});
 await page.locator('#screen-effect').selectOption('xbrz');await page.waitForFunction(()=>document.getElementById('effect-status').textContent==='シェーダー表示：xBRZ Freescale Multipass'&&!document.getElementById('effect-screen').hidden);
 const result=await page.evaluate(()=>{effects.render(fixture);const c=document.getElementById('effect-screen'),gl=c.getContext('webgl'),pixels=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let mixed=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>0&&pixels[i]<255)mixed++;return {mixed,error:gl.getError(),topRight:pixels[((c.height-1)*c.width+c.width-1)*4],bottomLeft:pixels[0]};});
 assert.equal(result.error,0);assert.ok(result.mixed>0);assert.equal(result.topRight,0);assert.equal(result.bottomLeft,255);console.log('xBRZ raster output: smoothed diagonal, correct orientation, no WebGL errors PASS',result);
 await context.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
