const {SMTPServer}=require('smtp-server');const {simpleParser}=require('mailparser');const c=require('crypto');
const {q}=require('./db');const {emit}=require('./events');const PLANS=require('./plans');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();const SHARED=require('./shared');const RULES=require('./inboundrules');
const MAX=10*1024*1024;const OM=require('./orgmail');
const owner=async(d,local)=>{
 if(d===SHARED.SHARED){const hd=SHARED.handleOf(local);if(!hd)return null;const [s]=await q('select user_id from handles where handle=$1',[hd]);return s?{user_id:s.user_id,domain:false}:null}
 const [a]=await q("select user_id from domains where name=$1 and status='verified' and receiving_ok limit 1",[d]);if(a)return{user_id:a.user_id,domain:true};
  return null};
async function domainRow(uid,d){const [r]=await q("select id from domains where user_id=$1 and name=$2 and status='verified' limit 1",[uid,d]);return r?r.id:null}
async function store(sess,raw){
 const p=await simpleParser(raw,{skipImageLinks:true});
 const from=((p.from&&p.from.value&&p.from.value[0])||{}).address||sess.envelope.mailFrom.address||'';
 const by=new Map();
 for(const r of sess.envelope.rcptTo){const a=r.address.toLowerCase(),d=a.split('@')[1],o=await owner(d,a.split('@')[0]);if(!o)continue;const k=o.user_id;if(!by.has(k))by.set(k,[]);by.get(k).push(a)}
 const ids=[];let over=false;
 {const om=sess.envelope.rcptTo.map(r=>r.address.toLowerCase());const got=await OM.receive(p,om,from);for(const x of got)ids.push(x)}
 for(const [uid,addrs] of by){
  const [{plan}]=await q('select eff_plan(plan,tariff) plan from users where id=$1',[uid]);const P=PLANS[plan]||PLANS.free;
  if(P.inbound){const [{n}]=await q("select count(*)::int n from emails where user_id=$1 and direction='in' and created_at>=date_trunc('month',now())",[uid]);if(n>=P.inbound){over=true;continue}}
  const id=c.randomUUID(),files=p.attachments||[],att=files.map(a=>({filename:a.filename||null,content_type:a.contentType,size:a.size}));
  const hd={};for(const k of['reply-to','list-id','auto-submitted','x-mailer'])if(p.headers.has(k)){const v=p.headers.get(k);hd[k]=typeof v==='string'?v:(v&&v.text)||''}
  const did=await domainRow(uid,addrs[0].split('@')[1]);
  const refs=[p.inReplyTo].concat(Array.isArray(p.references)?p.references:(p.references?[p.references]:[]));
  const tid=await require('./threads').thread(uid,refs,id);
  const hitInfo=await RULES.match(uid,addrs);
  if(hitInfo&&hitInfo.rule.action==='drop'){await RULES.hit(hitInfo.rule);ids.dropped=true;continue}
  await q("insert into emails(id,user_id,domain_id,direction,from_addr,to_addrs,subject,html,text_body,message_id,in_reply_to,status,attachments,headers,thread_id,rule_id) values($1,$2,$3,'in',$4,$5,$6,$7,$8,$9,$10,'received',$11,$12,$13,$14)",
   [id,uid,did,from.toLowerCase(),JSON.stringify(addrs),(p.subject||'').slice(0,998),p.html||null,p.text||null,p.messageId||null,p.inReplyTo||null,JSON.stringify(att),JSON.stringify(hd),tid,hitInfo?hitInfo.rule.id:null]);
  for(const f of files){if(f.content&&f.content.length)await q('insert into email_files(email_id,filename,content_type,size,data) values($1,$2,$3,$4,$5)',[id,f.filename||null,String(f.contentType||'application/octet-stream').slice(0,100),f.size||f.content.length,f.content])}
  await emit(id,'received',{from:from.toLowerCase(),attachments:att.length});
  if(hitInfo)await RULES.run(hitInfo,{id,uid,from:from.toLowerCase(),p});
  ids.push(id)}

 if(!ids.length&&over)throw Object.assign(new Error('over quota'),{quota:true});
 return ids}
function rcpt(addr,cb){const d=String(addr.address.split('@')[1]||'').toLowerCase(),lp=String(addr.address.split('@')[0]||'').toLowerCase();owner(d,lp).then(o=>{if(!o){const e=new Error('Recipient address rejected: user unknown');e.responseCode=550;return cb(e)}cb()},e=>{e.responseCode=451;cb(e)})}
function start(){
 if(process.env.INBOUND_PORT==='off')return;
 const srv=new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],size:MAX,disableReverseLookup:true,banner:'Geserd inbound',
  onRcptTo(addr,sess,cb){OM.box(addr.address).then(b=>{if(b)return cb();rcpt(addr,cb)},e=>{e.responseCode=451;cb(e)})},
  onData(stream,sess,cb){const ch=[];let n=0;stream.on('data',b=>{n+=b.length;if(n<=MAX)ch.push(b)});
   stream.on('end',()=>{if(stream.sizeExceeded){const e=new Error('Message too large');e.responseCode=552;return cb(e)}
    store(sess,Buffer.concat(ch)).then(ids=>{if(!ids.length&&!ids.dropped){const e=new Error('Mailbox unavailable');e.responseCode=550;return cb(e)}cb()},e=>{if(!e.quota)console.error('inbound',e.message);const x=new Error(e.quota?'Mailbox over quota, try again later':'Temporary local problem, try again later');x.responseCode=e.quota?452:451;cb(x)})})}});
 srv.on('error',e=>console.error('inbound smtp',e.message));
 const port=+process.env.INBOUND_PORT||2525;srv.listen(port,'127.0.0.1',()=>console.log('geserd inbound smtp on 127.0.0.1:'+port));
 return srv}
module.exports={start,store};
