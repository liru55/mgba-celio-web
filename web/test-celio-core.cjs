const assert=require('node:assert/strict'),path=require('node:path');
const create=require('../build-web/mgba.js');
(async()=>{
 const m=await create({locateFile:f=>path.join(__dirname,'../build-web',f),print:()=>{},printErr:()=>{}});
 const rom=new Uint8Array(32768);rom.set([0xfe,0xff,0xff,0xea]);rom[0xb2]=0x96;
 const upload=(data,fn)=>{const p=m._malloc(data.length);try{m.HEAPU8.set(data,p);return fn(p,data.length);}finally{m._free(p);}};
 const events=i=>{const out=[];let p;while((p=m._web_celio_poll(i)))out.push(Array.from(new Uint16Array(m.HEAPU8.buffer,p,34)));return out;};
 for(let round=0;round<3;round++){
  for(let slot=0;slot<2;slot++){m._web_select(slot);assert.equal(upload(rom,m._web_load),1);assert.equal(m._web_celio_start(slot),1);m._web_celio_command(slot,0);assert.ok(events(slot).some(a=>a[0]===1&&a[1]===0xFF02));m._web_celio_command(slot,slot===0?0x10:0x11);}
  for(let slot=0;slot<2;slot++){
   m._web_select(slot);m._web_bus_write16(0x04000134,0);m._web_bus_write16(0x04000128,0x2003);m._web_bus_write16(0x0400012a,0xB9A0);m._web_bus_read16(0x04000122);
   assert.ok(events(slot).some(a=>a[1]===0xFF03));m._web_celio_command(slot,0x12);m._web_bus_read16(0x04000122);m._web_bus_read16(0x04000122);
   assert.equal(m._web_bus_read16(0x04000128),slot===0?0x601F:0x600B);
   m._web_celio_command(slot,0x13);m._web_bus_read16(0x04000122);assert.ok(events(slot).some(a=>a[1]===0xFF05));
   const incoming=new Uint16Array(32);incoming[0]=0xCAFE;incoming[1]=0x1234;incoming[2]=0x9876;
   assert.equal(upload(new Uint8Array(incoming.buffer),(p,n)=>m._web_celio_receive(slot,p,n/2)),1);
   m._web_bus_write16(0x0400012a,0x1111);m._web_bus_read16(0x04000122); // CRC
   const output=m._web_bus_read16(0x04000122); // first command word
   assert.equal(slot===0?m._web_bus_read16(0x04000120):output,0xCAFE);
   for(let i=0;i<40;i++)m._web_bus_read16(0x04000122);
   assert.ok(events(slot).some(a=>a[0]===2&&a[1]===32));m._web_celio_stop(slot);m._web_close();
  }
 }
 console.log('Celio native device: master/slave masks, handshake, CRC/data packets, repeated attach/detach PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
