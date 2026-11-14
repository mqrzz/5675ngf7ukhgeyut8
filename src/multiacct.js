const {q}=require('./db');
const DISPOSABLE=new Set(['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','temp-mail.org','yopmail.com','trashmail.com','sharklasers.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mintemail.com','mohmal.com','emailondeck.com']);
const T={review:40,freeze:70};
const ZERO='00000000-0000-0000-0000-000000000000';
function emailDomain(e){return String(e||'').split('@')[1]||''}
const crypto=require('crypto');
function device(req){
 try{const h=req&&req.headers||{};let did=String(h['x-gd-did']||'');if(!/^[A-Za-z0-9-]{8,64}$/.test(did))did='';
  let fp='',info=null;const raw=String(h['x-gd-fp']||'').slice(0,600);
  if(raw){const j=JSON.parse(Buffer.from(raw,'base64').toString('utf8'));
   info={s:String(j.s||'').slice(0,24),tz:String(j.tz||'').slice(0,48),l:String(j.l||'').slice(0,40),p:String(j.p||'').slice(0,24),c:+j.c||0,m:+j.m||0,t:+j.t||0};
   fp=crypto.createHash('sha256').update(JSON.stringify([info.s,info.tz,info.l,info.p,info.c,info.m,info.t])).digest('hex').slice(0,32)}
  return{did,fp,info}}catch(e){return{did:'',fp:'',info:null}}}
async function saveDevice(uid,dev,ua){
 if(!dev.did&&!dev.fp)return;
 await q("insert into user_devices(user_id,did,fp,info,ua) values($1,$2,$3,$4,$5) on conflict(user_id,did,fp) do update set last_seen=now(),ua=excluded.ua",[uid,dev.did,dev.fp,dev.info?JSON.stringify(dev.info):null,ua])}
async function pair(me,o,ip,ua){
 const d={};let s=0;
 if(me.email_norm&&me.email_norm===o.email_norm){d.same_email=true;s+=90}
 const[ss]=await q("select count(*)::int n,bool_or(ua is not null and ua=$3) same_ua from sessions where user_id=$1 and ip=$2 and created_at>now()-interval '30 days'",[o.id,ip,ua||'']);
 if(ss.n>0){d.shared_ip_sessions=ss.n;s+=20+(ss.n>=3?10:0);if(ss.same_ua){d.same_browser=true;s+=25}
  if(Math.abs(new Date(me.created_at)-new Date(o.created_at))<48*3600000){d.created_close=true;s+=15}}
 const[inn]=await q("select count(*)::int n from siberia_applications a join siberia_applications b on b.inn=a.inn where (a.user_id=$1 or lower(a.email)=lower($2)) and (b.user_id=$3 or lower(b.email)=lower($4)) and a.id<>b.id",[me.id,me.email,o.id,o.email]);
 if(inn.n>0){d.same_inn=true;s+=60}
 const[ph]=await q("select count(*)::int n from siberia_applications a join siberia_applications b on regexp_replace(coalesce(b.phone,''),'[^0-9]','','g')=regexp_replace(coalesce(a.phone,''),'[^0-9]','','g') where length(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g'))>=7 and a.user_id=$1 and b.user_id=$2",[me.id,o.id]);
 if(ph.n>0){d.same_phone=true;s+=40}
 const[dv]=await q("select coalesce(bool_or(a.did<>'' and a.did=b.did),false) sd,coalesce(bool_or(a.fp<>'' and a.fp=b.fp),false) sf from user_devices a join user_devices b on (a.did<>'' and a.did=b.did) or (a.fp<>'' and a.fp=b.fp) where a.user_id=$1 and b.user_id=$2",[me.id,o.id]);
 if(dv&&dv.sd){d.same_browser_id=true;s+=45}
 if(dv&&dv.sf){d.same_device_profile=true;s+=30}
 const[ap]=await q("select count(*)::int n from api_logs where user_id=$1 and ip=$2 and created_at>now()-interval '7 days'",[o.id,ip]);
 if(ap.n>0){d.shared_api_ip=ap.n;s+=15}
 if(DISPOSABLE.has(emailDomain(me.email))||DISPOSABLE.has(emailDomain(o.email))){d.disposable_email=true;if(s>0)s+=10}
 if(s>=20&&(o.status==='frozen'||o.status==='blocked')){d.other_account_restricted=o.status;s+=30}
 return{score:Math.min(100,s),details:d}
}
async function upsert(uid,rel,kind,score,details,auto){
 const[ex]=await q("select id,score from risk_flags where user_id=$1 and coalesce(related_id,$4::uuid)=coalesce($2::uuid,$4::uuid) and kind=$3 and status='open'",[uid,rel,kind,ZERO]);
 if(ex){await q('update risk_flags set score=greatest(score,$2),details=$3,updated_at=now(),auto_action=coalesce(auto_action,$4) where id=$1',[ex.id,score,JSON.stringify(details),auto||null]);return ex.id}
 const[dis]=await q("select id from risk_flags where user_id=$1 and coalesce(related_id,$3::uuid)=coalesce($2::uuid,$3::uuid) and kind=$4 and status='dismissed' limit 1",[uid,rel,ZERO,kind]);
 if(dis)return null;
 const[f]=await q('insert into risk_flags(user_id,related_id,kind,score,details,auto_action) values($1,$2,$3,$4,$5,$6) returning id',[uid,rel,kind,score,JSON.stringify(details),auto||null]);
 return f.id
}
async function check(uid,req){
 const ip=req&&req.ip?String(req.ip):null,ua=req&&req.headers&&req.headers['user-agent']?String(req.headers['user-agent']).slice(0,300):null;
 const[me]=await q('select id,email,email_norm,created_at,status,plan,is_admin from users where id=$1',[uid]);
 if(!me)return{flags:[]};
 const out=[];
 await saveDevice(uid,device(req),ua).catch(e=>console.error('device',e.message));
 const cands=await q("select o.id,o.email,o.email_norm,o.created_at,o.status,o.plan,o.is_admin from users o where o.id<>$1 and (o.email_norm=$2 or ($3::text is not null and (o.id in (select user_id from sessions where ip=$3 and created_at>now()-interval '30 days') or o.id in (select user_id from api_logs where ip=$3 and created_at>now()-interval '7 days'))) or o.id in (select b.user_id from siberia_applications a join siberia_applications b on b.inn=a.inn and b.user_id is not null where (a.user_id=$1 or lower(a.email)=lower($4)) and b.user_id<>$1)) limit 25",[uid,me.email_norm,ip,me.email]);
 for(const x of await q("select distinct b.user_id id from user_devices a join user_devices b on b.user_id<>a.user_id and ((a.did<>'' and a.did=b.did) or (a.fp<>'' and a.fp=b.fp)) where a.user_id=$1 limit 25",[uid])){if(!cands.some(c=>c.id===x.id)){const[oo]=await q('select id,email,email_norm,created_at,status,plan,is_admin from users where id=$1',[x.id]);if(oo)cands.push(oo)}}
 for(const o of cands){
  const p=await pair(me,o,ip,ua);
  if(p.score<T.review)continue;
  const newer=new Date(me.created_at)>=new Date(o.created_at)?me:o,older=newer===me?o:me;
  // Flag only. Nothing is frozen or banned automatically: a person reviews every case in the admin panel.
  const auto=p.score>=T.freeze?'priority':null;
  const id=await upsert(newer.id,older.id,'multi_account',p.score,p.details,auto);
  if(id)out.push({id,user:newer.id,related:older.id,score:p.score,auto})
 }
 if(ip){
  const[b]=await q("select count(distinct user_id)::int n from sessions where ip=$1 and created_at>now()-interval '24 hours'",[ip]);
  if(b.n>=4){const id=await upsert(uid,null,'ip_burst',45,{accounts_24h:b.n,ip},null);if(id)out.push({id,user:uid,related:null,score:45,auto:null})}
 }
 return{flags:out}
}
module.exports={check,pair,T,device,saveDevice};
