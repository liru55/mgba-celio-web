/* MPL-2.0. Read-only frontend for the core's raw memory access. */
window.createMemoryViewer=({m,$,available})=>{
 const viewer=$('memory-viewer'),address=$('memory-address'),region=$('memory-region'),status=$('memory-status'),dump=$('memory-dump');
 let base=0x02000000,previous=null,previousBase=-1,max=0x0FFFFFFF;
 const hex=(v,n)=>v.toString(16).toUpperCase().padStart(n,'0');
 function render(){
  if(!available()){status.textContent='ROM未選択、読み込み中、または通信中のため利用できません。';dump.textContent='';return;}
  const bytes=new Uint8Array(256);let changed=0;for(let i=0;i<256;i++){bytes[i]=m._web_memory_read8((base+i)&max)&255;if(previous&&previousBase===base&&previous[i]!==bytes[i])changed++;}
  const lines=['ADDRESS   '+Array.from({length:16},(_,i)=>hex(i,2)).join(' ')+'  ASCII'];
  for(let row=0;row<16;row++){const data=bytes.subarray(row*16,row*16+16);lines.push(hex((base+row*16)&max,8)+'  '+Array.from(data,v=>hex(v,2)).join(' ')+'  '+Array.from(data,v=>v>=32&&v<=126?String.fromCharCode(v):'.').join(''));}
  dump.textContent=lines.join('\n');status.textContent=hex(base,8)+'〜'+hex((base+255)&max,8)+' · 256バイト'+(previous&&previousBase===base?' · 変化 '+changed+'バイト':'');previous=bytes;previousBase=base;
 }
 function go(){const value=address.value.trim().replace(/^0x/i,'');if(!/^[0-9a-f]{1,8}$/i.test(value)||parseInt(value,16)>max){status.textContent='範囲内の16進数アドレスを入力してください（最大 '+hex(max,8)+'）。';return;}base=parseInt(value,16);address.value=hex(base,8);render();}
 function step(direction){base=Math.max(0,Math.min(max-255,base+direction*256));address.value=hex(base,8);render();}
 function onGame(){
  const gba=m._web_platform()===0;max=gba?0x0FFFFFFF:0xFFFF;
  const regions=gba?[['EWRAM',0x02000000],['IWRAM',0x03000000],['I/O',0x04000000],['パレット',0x05000000],['VRAM',0x06000000],['OAM',0x07000000],['ROM',0x08000000],['セーブ領域',0x0E000000]]:[['ROM',0],['ROMバンク',0x4000],['VRAM',0x8000],['外部RAM',0xA000],['WRAM',0xC000],['OAM',0xFE00],['I/O',0xFF00],['HRAM',0xFF80]];
  region.replaceChildren(...regions.map(([name,value])=>{const option=document.createElement('option');option.value=value;option.textContent=name+' · '+hex(value,8);return option;}));base=regions[0][1];address.value=hex(base,8);previous=null;if(viewer.open)render();
 }
 region.onchange=()=>{base=Number(region.value);address.value=hex(base,8);render();};$('memory-go').onclick=go;$('memory-refresh').onclick=go;$('memory-prev').onclick=()=>step(-1);$('memory-next').onclick=()=>step(1);
 address.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go();}});viewer.addEventListener('toggle',()=>{if(viewer.open){if(!region.options.length)onGame();render();}});
 setInterval(()=>{if(viewer.open&&$('memory-auto').checked&&!document.hidden)render();},500);
 return {onGame};
};
