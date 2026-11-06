const fs=require('fs'),{spawn}=require('child_process');
const {q}=require('./db');const {emit}=require('./events');
const LINE=/postfix(?:-[\w-]+)?\/(\w+)\[\d+\]: ([0-9A-Za-z]{8,20}): (.*)$/;
const UUID=/<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i;
const AGENTS=new Set(['smtp','lmtp','local','virtual']);

function parseLine(line){
 const m=LINE.exec(line);if(!m)return null;const svc=m[1],qid=m[2],rest=m[3];
 if(svc==='cleanup'){const mm=/message-id=(<[^>]*>)/.exec(rest);const u=mm&&UUID.exec(mm[1]);return u?{kind:'map',queue:qid,email:u[1].toLowerCase()}:null}
 if(AGENTS.has(svc)){
  const to=/(?:^|, )to=<([^>]*)>/.exec(rest),st=/status=(\w+)(?: \((.*)\))?\s*$/.exec(rest);if(!to||!st)return null;
  const dsn=(/dsn=(\d\.\d{1,3}\.\d{1,3})/.exec(rest)||[])[1]||'';
  return{kind:'status',queue:qid,to:to[1].toLowerCase(),status:st[1],dsn,detail:(st[2]||'').slice(0,500)};
 }
 return null;
}
const TYPE={sent:'delivered',bounced:'bounced',deferred:'delayed'};
async function handle(line){
 const p=parseLine(line);if(!p)return null;
 if(p.kind==='map'){await q('insert into mail_queue(queue_id,email_id) select $1,id from emails where id=$2 on conflict do nothing',[p.queue,p.email]);return p}
 const type=TYPE[p.status];if(!type)return null;
 const [r]=await q('select email_id from mail_queue where queue_id=$1',[p.queue]);if(!r)return null;
 const dup=await q("select 1 from events where email_id=$1 and type=$2 and data->>'queue'=$3 and data->>'recipient'=$4 and coalesce(data->>'detail','')=$5 limit 1",[r.email_id,type,p.queue,p.to,p.detail]);
 if(dup.length)return null;
 await emit(r.email_id,type,{recipient:p.to,dsn:p.dsn,detail:p.detail,queue:p.queue,...(type==='bounced'?{reason:p.detail}:{})});
 return p;
}

let stopped=false,child=null,fileTimer=null;
const kvGet=async k=>((await q('select value from kv where key=$1',[k]))[0]||{}).value;
const kvSet=(k,v)=>q('insert into kv(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[k,String(v)]);
let chain=Promise.resolve();const queue=l=>{chain=chain.then(()=>handle(l)).catch(e=>console.error('mailevents',e.message))};

function tailFile(path){
 let ino=null,pos=0,busy=false,buf='';
 const KEY='mailevents.file';
 (async()=>{const v=await kvGet(KEY);let st;try{st=fs.statSync(path)}catch{return}
  if(v){const o=JSON.parse(v);if(o.ino===st.ino&&o.pos<=st.size){ino=o.ino;pos=o.pos}}
  if(ino==null){ino=st.ino;pos=st.size}
  fileTimer=setInterval(tick,1000);fileTimer.unref();tick()})().catch(e=>console.error('mailevents',e.message));
 function tick(){
  if(busy||stopped)return;let st;try{st=fs.statSync(path)}catch{return}
  if(st.ino!==ino){ino=st.ino;pos=0;buf=''}
  else if(st.size<pos){pos=0;buf=''}
  if(st.size===pos)return;busy=true;
  const fd=fs.openSync(path,'r');const n=Math.min(st.size-pos,4<<20),b=Buffer.alloc(n);fs.readSync(fd,b,0,n,pos);fs.closeSync(fd);pos+=n;
  const parts=(buf+b.toString('utf8')).split('\n');buf=parts.pop();parts.forEach(queue);
  chain.then(()=>kvSet(KEY,JSON.stringify({ino,pos:pos-Buffer.byteLength(buf)}))).catch(()=>{}).then(()=>{busy=false});
 }
}
function tailJournal(){
 const KEY='mailevents.cursor';let cursor='',lastSave=0,warned=false;
 (async()=>{cursor=(await kvGet(KEY))||'';start()})().catch(e=>console.error('mailevents',e.message));
 function start(){
  if(stopped)return;
  const a=['-f','-o','json','--no-pager'];for(const s of['cleanup','smtp','lmtp','local','virtual'])a.push('-t','postfix/'+s);
  if(cursor)a.push('--after-cursor='+cursor);else a.push('-n','0');
  child=spawn('journalctl',a,{stdio:['ignore','pipe','pipe']});let buf='';
  child.stdout.on('data',d=>{buf+=d.toString('utf8');const parts=buf.split('\n');buf=parts.pop();
   for(const l of parts){let j;try{j=JSON.parse(l)}catch{continue}
    if(j.MESSAGE&&j.SYSLOG_IDENTIFIER)queue(j.SYSLOG_IDENTIFIER+'['+(j._PID||0)+']: '+j.MESSAGE);
    if(j.__CURSOR)cursor=j.__CURSOR}
   if(Date.now()-lastSave>2000&&cursor){lastSave=Date.now();chain.then(()=>kvSet(KEY,cursor)).catch(()=>{})}});
  child.stderr.on('data',d=>{const s=d.toString();if(!warned&&/permission|not seeing messages|No journal/i.test(s)){warned=true;console.error('mailevents: cannot read the journal — the service user must be in group systemd-journal (SupplementaryGroups in geserd-api.service). '+s.trim())}});
  child.on('exit',()=>{child=null;if(!stopped)setTimeout(start,5000).unref()});
  child.on('error',e=>{console.error('mailevents: journalctl failed:',e.message)});
 }
}
function start(){
 const want=process.env.MAIL_LOG||'';
 if(want==='off')return console.log('mailevents: disabled');
 let file=null;
 if(want&&want!=='journal')file=want;else if(!want){try{fs.accessSync('/var/log/mail.log',fs.constants.R_OK);file='/var/log/mail.log'}catch{}}
 if(file){console.log('mailevents: tailing',file);tailFile(file)}else{console.log('mailevents: reading the systemd journal');tailJournal()}
}
function stop(){stopped=true;if(fileTimer)clearInterval(fileTimer);if(child)child.kill()}
module.exports={start,stop,parseLine,handle};
