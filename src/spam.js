const net=require('net');
const HOST=process.env.SPAMD_HOST||'127.0.0.1',PORT=+process.env.SPAMD_PORT||783,LIMIT=+process.env.SPAM_LIMIT||5,MAXRAW=1500000;
const IGNORE=new Set(['NO_RECEIVED','NO_RELAYS','NO_RECEIVED','MISSING_HEADERS']);
function run(raw){
 return new Promise(resolve=>{
  if(process.env.SPAMD==='off'||raw.length>MAXRAW)return resolve(null);
  const s=net.connect({host:HOST,port:PORT});let buf=[],done=false;
  const fin=v=>{if(done)return;done=true;s.destroy();resolve(v)};
  s.setTimeout(12000,()=>fin(null));
  s.on('error',()=>fin(null));
  s.on('connect',()=>{s.write('REPORT SPAMC/1.5\r\nContent-length: '+raw.length+'\r\n\r\n');s.write(raw);s.end()});
  s.on('data',d=>buf.push(d));
  s.on('end',()=>{
   const t=Buffer.concat(buf).toString('utf8'),m=/Spam:\s*(\w+)\s*;\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/i.exec(t);
   if(!m)return fin(null);
   const score=parseFloat(m[2]),rules=[],i=t.search(/Content analysis details/i);
   if(i>=0){const lines=t.slice(i).split(/\r?\n/);let cur=null;
    for(const l of lines.slice(1)){const r=/^\s*(-?\d+\.\d+)\s+([A-Z][A-Z0-9_]+)\s+(.*)$/.exec(l);
     if(r){cur={rule:r[2],score:parseFloat(r[1]),description:r[3].trim()};rules.push(cur)}
     else if(cur&&/^\s{10,}\S/.test(l))cur.description+=' '+l.trim()}}
   fin({score,limit:parseFloat(m[3])||LIMIT,rules:rules.filter(x=>x.score!==0&&!IGNORE.has(x.rule)).sort((a,b)=>b.score-a.score)})});
 })}
async function check(raw){const r=await run(raw);if(!r)return null;return{...r,verdict:r.score>=r.limit?'spam':r.score>=r.limit*0.6?'risky':'clean'}}
module.exports={check,LIMIT};
