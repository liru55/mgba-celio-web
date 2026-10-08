/* MPL-2.0. Web Serial port of upstream CelioNet.cpp 01eb03516. */
(function(root){class CelioSerial{
 constructor(port,frame,error){Object.assign(this,{port,onFrame:frame,onError:error,buffer:[],pending:0,closed:false,queue:Promise.resolve()});}
 static frame(ch,p){if(p.length>64)throw Error('USB通信データが大きすぎます');return Uint8Array.from([71,66,ch,p.length,0,...p]);}
 feed(chunk){for(const byte of chunk){this.buffer.push(byte);while(this.buffer.length>=5){if(this.buffer[0]!==71||this.buffer[1]!==66){this.buffer.shift();continue;}const n=this.buffer[3]|this.buffer[4]<<8;if(n>64){this.buffer.splice(0,5);continue;}if(this.buffer.length<n+5)break;const f=this.buffer.splice(0,n+5);this.onFrame(f[2],Uint8Array.from(f.slice(5)));}}}
 async open(){await this.port.open({baudRate:115200});try{await this.port.setSignals({dataTerminalReady:true,requestToSend:true});}catch(_){}this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();this.readTask=this.read();}
 async read(){try{while(!this.closed){const {value,done}=await this.reader.read();if(done)break;if(value)this.feed(value);}if(!this.closed)this.onError(Error('USB変換器が外れました'));}catch(e){if(!this.closed)this.onError(e);}finally{this.reader.releaseLock();}}
 send(ch,p){if(this.closed)return;if(this.pending++>256){this.pending--;this.onError(Error('USB通信が追いつきません'));return;}const f=CelioSerial.frame(ch,p);this.queue=this.queue.then(()=>this.writer.write(f)).catch(e=>{if(!this.closed)this.onError(e)}).finally(()=>this.pending--);}
 command(v){this.send(0,v===0?[0,1]:[v&255]);}
 data(words){if(words.length!==32)throw Error('不正なUSB通信データです');const p=[];for(const v of words)p.push(v&255,v>>8);this.send(1,p);}
 async close(){if(this.closed)return;this.closed=true;try{await this.reader?.cancel();await this.readTask;await this.queue;this.writer?.releaseLock();await this.port.close();}catch(_){}}
}if(typeof module!=='undefined')module.exports=CelioSerial;else root.CelioSerial=CelioSerial;})(globalThis);
