const c=require('crypto');const {q}=require('./db');const {send,E}=require('./send');const TPL=require('./template');const {notify}=require('./notify');
const BASE=process.env.PUBLIC_URL||('https://'+(process.env.BASE_DOMAIN||'geserd.com'));
const key=()=>Buffer.from(process.env.SECRET_KEY,'hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const GAP=process.env.BROADCAST_GAP_MS!=null&&+process.env.BROADCAST_GAP_MS>=0?+process.env.BROADCAST_GAP_MS:600;
function token(contactId){const sig=c.createHmac('sha256',key()).update('unsub:'+contactId).digest('base64url').slice(0,22);return contactId+'.'+sig}
function verify(t){
 const m=/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(String(t||''));if(!m)return null;
 const want=Buffer.from(c.createHmac('sha256',key()).update('unsub:'+m[1]).digest('base64url').slice(0,22)),got=Buffer.from(m[2]);
 return want.length===got.length&&c.timingSafeEqual(want,got)?m[1]:null
}
function pageUrl(t){return BASE+'/unsubscribe/?t='+t}
function oneClick(t){return BASE+'/api/unsubscribe/'+t}
function footer(url,html){
 if(html)return'<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a;">You are receiving this email because you subscribed. <a href="'+url+'" style="color:#8a8a8a;">Unsubscribe</a></div>';
 return'\n\n--\nYou are receiving this email because you subscribed.\nUnsubscribe: '+url
}
function compose(b,r,url){
 const v={first_name:r.first_name||'',last_name:r.last_name||'',email:r.email,unsubscribe_url:url};
 let html=b.html?TPL.render(b.html,v,true):null,text=b.text_body?TPL.render(b.text_body,v,false):null;
 if(html){const f=footer(url,true);html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,f+'</body>'):html+f}
 if(!html&&!text)throw E('empty_body');
 text=(text||'')+footer(url,false);
 return{from:b.from_addr,to:[r.email],reply_to:b.reply_to||undefined,subject:TPL.render(b.subject||'',v,false),html:html||undefined,text,headers:{'List-Unsubscribe':'<'+oneClick(token(r.contact_id||r.id||'00000000-0000-0000-0000-000000000000'))+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}
}
function nextBoundary(scope){const d=new Date();if(scope==='daily')return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,0,5));return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1,0,5))}
async function start(b){
 const rows=await q("insert into broadcast_recipients(broadcast_id,contact_id,email,first_name,last_name) select $1,id,email,first_name,last_name from contacts where audience_id=$2 and not unsubscribed on conflict do nothing returning 1",[b.id,b.audience_id]);
 await q("update broadcasts set status='sending',total=(select count(*) from broadcast_recipients where broadcast_id=$1),started_at=coalesce(started_at,now()),resume_at=null,error=null,updated_at=now() where id=$1",[b.id]);
 return rows.length
}
async function finish(b,status,error){
 await q("update broadcasts set status=$2,error=$3,finished_at=case when $2 in('sent','failed','canceled') then now() else finished_at end,updated_at=now() where id=$1",[b.id,status,error||null])
}
async function runOne(b){
 for(let n=0;n<40;n++){
  const[cur]=await q('select status from broadcasts where id=$1',[b.id]);
  if(!cur||cur.status!=='sending')return;
  const[r]=await q("select * from broadcast_recipients where broadcast_id=$1 and status='pending' limit 1",[b.id]);
  if(!r){const[t]=await q("select count(*) filter(where status='sent')::int s from broadcast_recipients where broadcast_id=$1",[b.id]);await finish(b,t.s?'sent':'failed',t.s?null:'no_recipients_sent');if(t.s)notify(b.user_id,'broadcast','broadcast_done',b.name,'/app/broadcasts/view/?id='+b.id,'bc:'+b.id);return}
  const[ct]=r.contact_id?await q('select id,unsubscribed from contacts where id=$1',[r.contact_id]):[null];
  if(ct&&ct.unsubscribed){await q("update broadcast_recipients set status='skipped',error='unsubscribed' where broadcast_id=$1 and email=$2",[b.id,r.email]);await q('update broadcasts set skipped=skipped+1 where id=$1',[b.id]);continue}
  const cid=r.contact_id||'00000000-0000-0000-0000-000000000000';
  let payload;try{payload=compose(b,{...r,contact_id:cid},pageUrl(token(cid)))}catch(e){await finish(b,'failed',e.code||'invalid');return}
  try{
   const out=await send(b.user_id,payload,null);
   await q("update broadcast_recipients set status='sent',email_id=$3 where broadcast_id=$1 and email=$2",[b.id,r.email,out.id]);
   await q('update broadcasts set sent=sent+1,updated_at=now() where id=$1',[b.id]);
   await sleep(GAP)
  }catch(e){
   const code=e&&e.code;
   if(code==='rate_limited'){await sleep(800);continue}
   if(code==='quota_exceeded'){const at=nextBoundary(e.extra&&e.extra.scope);await q("update broadcasts set status='paused',resume_at=$2,error='quota_exceeded',updated_at=now() where id=$1",[b.id,at]);notify(b.user_id,'broadcast','broadcast_paused',b.name,'/app/broadcasts/view/?id='+b.id,'bcp:'+b.id+':'+at.toISOString().slice(0,10));return}
   if(code==='domain_not_verified'||code==='invalid_from'||code==='spam_rejected'){await finish(b,'failed',code);notify(b.user_id,'broadcast','broadcast_failed',b.name,'/app/broadcasts/view/?id='+b.id,'bcf:'+b.id);return}
   if(code==='all_recipients_suppressed'){await q("update broadcast_recipients set status='skipped',error='suppressed' where broadcast_id=$1 and email=$2",[b.id,r.email]);await q('update broadcasts set skipped=skipped+1 where id=$1',[b.id]);continue}
   await q("update broadcast_recipients set status='failed',error=$3 where broadcast_id=$1 and email=$2",[b.id,r.email,String(code||e.message).slice(0,200)]);
   await q('update broadcasts set failed=failed+1,updated_at=now() where id=$1',[b.id]);
   await sleep(300)
  }
 }
}
let busy=false;
async function tick(){
 if(busy)return;busy=true;
 try{
  const due=await q("select * from broadcasts where (status='scheduled' and scheduled_at<=now()) or (status='paused' and resume_at<=now())");
  for(const b of due){if(b.status==='scheduled')await start(b);else await q("update broadcasts set status='sending',resume_at=null,error=null where id=$1",[b.id])}
  const act=await q("select * from broadcasts where status='sending' order by started_at");
  for(const b of act)await runOne(b)
 }finally{busy=false}
}
function startWorker(){const t=setInterval(()=>tick().catch(e=>console.error('broadcast',e.message)),4000);t.unref()}
module.exports={token,verify,start,tick,startWorker,compose,pageUrl,footer};
