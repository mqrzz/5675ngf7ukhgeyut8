const {q}=require('./db');const {notify}=require('./notify');
const DISPOSABLE=new Set(['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','temp-mail.org','yopmail.com','trashmail.com','sharklasers.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mintemail.com','mohmal.com','emailondeck.com']);
const T={review:40,freeze:70};
const ZERO='00000000-0000-0000-0000-000000000000';
function emailDomain(e){return String(e||'').split('@')[1]||''}
async function pair(me,o,ip,ua){
 const d={};let s=0;
 if(me.email_norm&&me.email_norm===o.email_norm){d.same_email=true;s+=90}
 const[ss]=await q("select count(*)::int n,bool_or(ua is not null and ua=$3) same_ua from sessions where user_id=$1 and ip=$2 and created_at>now()-interval '30 days'",[o.id,ip,ua||'']);
 if(ss.n>0){d.shared_ip_sessions=ss.n;s+=20+(ss.n>=3?10:0);if(ss.same_ua){d.same_browser=true;s+=25}
  if(Math.abs(new Date(me.created_at)-new Date(o.created_at))<48*3600000){d.created_close=true;s+=15}}
 const[inn]=await q("select count(*)::int n from siberia_applications a join siberia_applications b on b.inn=a.inn where (a.user_id=$1 or lower(a.email)=lower($2)) and (b.user_id=$3 or lower(b.email)=lower($4)) and a.id<>b.id",[me.id,me.email,o.id,o.email]);
 if(inn.n>0){d.same_inn=true;s+=60}
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
async function freeze(u,reason){
 await q("update users set status='frozen',status_reason=$2,status_at=now() where id=$1 and status='active'",[u.id,reason]);
 await q("insert into admin_actions(user_id,action,details) values($1,'auto_freeze',$2)",[u.id,JSON.stringify({reason})]);
 await notify(u.id,'account','account_frozen',null,'/app/help/tickets/new/','frozen:'+u.id+':'+Date.now())
}
async function check(uid,req){
 const ip=req&&req.ip?String(req.ip):null,ua=req&&req.headers&&req.headers['user-agent']?String(req.headers['user-agent']).slice(0,300):null;
 const[me]=await q('select id,email,email_norm,created_at,status,plan,is_admin from users where id=$1',[uid]);
 if(!me)return{flags:[]};
 const out=[];
 const cands=await q("select o.id,o.email,o.email_norm,o.created_at,o.status,o.plan,o.is_admin from users o where o.id<>$1 and (o.email_norm=$2 or ($3::text is not null and (o.id in (select user_id from sessions where ip=$3 and created_at>now()-interval '30 days') or o.id in (select user_id from api_logs where ip=$3 and created_at>now()-interval '7 days'))) or o.id in (select b.user_id from siberia_applications a join siberia_applications b on b.inn=a.inn and b.user_id is not null where (a.user_id=$1 or lower(a.email)=lower($4)) and b.user_id<>$1)) limit 25",[uid,me.email_norm,ip,me.email]);
 for(const o of cands){
  const p=await pair(me,o,ip,ua);
  if(p.score<T.review)continue;
  const newer=new Date(me.created_at)>=new Date(o.created_at)?me:o,older=newer===me?o:me;
  let auto=null;
  if(p.score>=T.freeze&&newer.status==='active'&&!newer.is_admin&&newer.plan==='free'){await freeze(newer,'multi_account_review');auto='freeze'}
  const id=await upsert(newer.id,older.id,'multi_account',p.score,p.details,auto);
  if(id)out.push({id,user:newer.id,related:older.id,score:p.score,auto})
 }
 if(ip){
  const[b]=await q("select count(distinct user_id)::int n from sessions where ip=$1 and created_at>now()-interval '24 hours'",[ip]);
  if(b.n>=4){const id=await upsert(uid,null,'ip_burst',45,{accounts_24h:b.n,ip},null);if(id)out.push({id,user:uid,related:null,score:45,auto:null})}
 }
 return{flags:out}
}
module.exports={check,pair,T};
