const {SMTPServer}=require('smtp-server');const {simpleParser}=require('mailparser');const c=require('crypto');
const {q}=require('./db');const {emit}=require('./events');const PLANS=require('./plans');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const MAX=10*1024*1024;
const owner=async d=>{
 const [a]=await q("select user_id from domains where name=$1 and status='verified' and receiving_ok limit 1",[d]);if(a)return{user_id:a.user_id,domain:true};
 if(d.endsWith('.'+BASE)){const slug=d.slice(0,-(BASE.length+1));if(slug&&!slug.includes('.')){const [s]=await q('select user_id from subdomains where slug=$1',[slug]);if(s)return{user_id:s.user_id,domain:false}}}
 return null};
async function domainRow(uid,d){const [r]=await q("select id from domains where user_id=$1 and name=$2 and status='verified' limit 1",[uid,d]);return r?r.id:null}
async function store(sess,raw){
 const p=await simpleParser(raw,{skipImageLinks:true});
 const from=((p.from&&p.from.value&&p.from.value[0])||{}).address||sess.envelope.mailFrom.address||'';
 const by=new Map();
 for(const r of sess.envelope.rcptTo){const a=r.address.toLowerCase(),d=a.split('@')[1],o=await owner(d);if(!o)continue;const k=o.user_id;if(!by.has(k))by.set(k,[]);by.get(k).push(a)}
 const ids=[];let over=false;
 for(const [uid,addrs] of by){
  const [{plan}]=await q('select plan from users where id=$1',[uid]);const P=PLANS[plan]||PLANS.free;
  if(P.inbound){const [{n}]=await q("select count(*)::int n from emails where user_id=$1 and direction='in' and created_at>=date_trunc('month',now())",[uid]);if(n>=P.inbound){over=true;continue}}
  const id=c.randomUUID(),att=(p.attachments||[]).map(a=>({filename:a.filename||null,content_type:a.contentType,size:a.size}));
  const hd={};for(const k of['reply-to','list-id','auto-submitted','x-mailer'])if(p.headers.has(k)){const v=p.headers.get(k);hd[k]=typeof v==='string'?v:(v&&v.text)||''}
  const did=await domainRow(uid,addrs[0].split('@')[1]);
  await q("insert into emails(id,user_id,domain_id,direction,from_addr,to_addrs,subject,html,text_body,message_id,in_reply_to,status,attachments,headers) values($1,$2,$3,'in',$4,$5,$6,$7,$8,$9,$10,'received',$11,$12)",
   [id,uid,did,from.toLowerCase(),JSON.stringify(addrs),(p.subject||'').slice(0,998),p.html||null,p.text||null,p.messageId||null,p.inReplyTo||null,JSON.stringify(att),JSON.stringify(hd)]);
  await emit(id,'received',{from:from.toLowerCase(),attachments:att.length});
  ids.push(id)}

 if(!ids.length&&over)throw Object.assign(new Error('over quota'),{quota:true});
 return ids}
function start(){
 if(process.env.INBOUND_PORT==='off')return;
 const srv=new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],size:MAX,disableReverseLookup:true,banner:'Geserd inbound',
  onRcptTo(addr,sess,cb){const d=String(addr.address.split('@')[1]||'').toLowerCase();owner(d).then(o=>{if(!o){const e=new Error('Recipient address rejected: user unknown');e.responseCode=550;return cb(e)}cb()},e=>{e.responseCode=451;cb(e)})},
  onData(stream,sess,cb){const ch=[];let n=0;stream.on('data',b=>{n+=b.length;if(n<=MAX)ch.push(b)});
   stream.on('end',()=>{if(stream.sizeExceeded){const e=new Error('Message too large');e.responseCode=552;return cb(e)}
    store(sess,Buffer.concat(ch)).then(ids=>{if(!ids.length){const e=new Error('Mailbox unavailable');e.responseCode=550;return cb(e)}cb()},e=>{if(!e.quota)console.error('inbound',e.message);const x=new Error(e.quota?'Mailbox over quota, try again later':'Temporary local problem, try again later');x.responseCode=e.quota?452:451;cb(x)})})}});
 srv.on('error',e=>console.error('inbound smtp',e.message));
 const port=+process.env.INBOUND_PORT||2525;srv.listen(port,'127.0.0.1',()=>console.log('geserd inbound smtp on 127.0.0.1:'+port));
 return srv}
module.exports={start,store};
