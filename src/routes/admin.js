const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const {notify}=require('../notify');const {transport,FROM}=require('../mailer');
const ID=/^[0-9a-f-]{36}$/i;
const CTAH={en:'Open the conversation',ru:'Открыть переписку',fr:'Ouvrir la conversation',de:'Gespräch öffnen'};
const SUBJ={en:'Geserd support replied to your ticket',ru:'Поддержка Geserd ответила на ваше обращение',fr:'Le support Geserd a répondu à votre demande',de:'Der Geserd-Support hat auf Ihre Anfrage geantwortet'};
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const ROLES=['owner','director','admin','support'];
const AREA={overview:['owner','director','admin','support'],tickets:['owner','director','admin','support'],users:['owner','director','admin','support'],review:['owner','director','admin'],risk:['owner','director','admin'],siberia:['owner','director','admin'],maintenance:['owner','director','admin'],incidents:['owner','director','admin'],'rating-rules':['owner','director'],analytics:['owner','director','admin'],sso:['owner','director'],staff:['owner','director'],me:ROLES};
const WRITE_ONLY={users:['owner','director','admin']};
r.use(need,sessionOnly,w(async(req,res,next)=>{
 const [u]=await q('select id,email,is_admin,staff_role from users where id=$1',[req.user.id]);
 if(!u||!u.is_admin)return res.status(403).json({error:'forbidden'});
 const role=ROLES.includes(u.staff_role)?u.staff_role:'admin';
 const area=(req.path.split('/')[1]||'overview');
 const allow=AREA[area];
 if(!allow||!allow.includes(role))return res.status(403).json({error:'forbidden_role'});
 if(req.method!=='GET'&&WRITE_ONLY[area]&&!WRITE_ONLY[area].includes(role))return res.status(403).json({error:'forbidden_role'});
 req.staff={id:u.id,email:u.email,role};next()}));
r.get('/me',w(async(req,res)=>{
 const role=req.staff.role;
 res.json({role,areas:Object.keys(AREA).filter(k=>k!=='me'&&k!=='risk'&&AREA[k].includes(role)),can_write_users:WRITE_ONLY.users.includes(role)})}));
const RANK={owner:4,director:3,admin:2,support:1};
const staffView=x=>({id:x.id,email:x.email,name:x.name,role:ROLES.includes(x.staff_role)?x.staff_role:'admin',created_at:x.created_at,last_seen:x.last_seen||null});
r.get('/staff',w(async(req,res)=>{
 const rows=await q("select u.id,u.email,u.name,u.staff_role,u.created_at,(select max(created_at) from sessions s where s.user_id=u.id) last_seen from users u where u.is_admin order by case u.staff_role when 'owner' then 0 when 'director' then 1 when 'admin' then 2 else 3 end,u.created_at");
 res.json({me:req.staff.id,my_role:req.staff.role,items:rows.map(staffView),assignable:req.staff.role==='owner'?['director','admin','support']:['admin','support']})}));
r.post('/staff',w(async(req,res)=>{
 const b=req.body||{},email=String(b.email||'').trim().toLowerCase(),role=String(b.role||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'invalid_email'});
 if(!ROLES.includes(role)||role==='owner')return res.status(400).json({error:'invalid_role'});
 if(RANK[role]>=RANK[req.staff.role])return res.status(403).json({error:'forbidden_role'});
 const[u]=await q('select id,is_admin,staff_role from users where lower(email)=$1',[email]);
 if(!u)return res.status(404).json({error:'user_not_found'});
 if(u.is_admin)return res.status(409).json({error:'already_staff'});
 await q('update users set is_admin=true,staff_role=$2 where id=$1',[u.id,role]);
 await act(req.user.id,u.id,'staff_add',{role});
 res.status(201).json({ok:true})}));
r.patch('/staff/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const role=String((req.body||{}).role||'');
 if(!ROLES.includes(role)||role==='owner')return res.status(400).json({error:'invalid_role'});
 if(req.params.id===req.user.id)return res.status(403).json({error:'forbidden_self'});
 const[u]=await q('select id,is_admin,staff_role from users where id=$1',[req.params.id]);
 if(!u||!u.is_admin)return res.status(404).json({error:'not_found'});
 const cur=ROLES.includes(u.staff_role)?u.staff_role:'admin';
 if(RANK[cur]>=RANK[req.staff.role]||RANK[role]>=RANK[req.staff.role])return res.status(403).json({error:'forbidden_role'});
 await q('update users set staff_role=$2 where id=$1',[u.id,role]);
 await act(req.user.id,u.id,'staff_role',{from:cur,to:role});
 res.json({ok:true,role})}));
r.delete('/staff/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 if(req.params.id===req.user.id)return res.status(403).json({error:'forbidden_self'});
 const[u]=await q('select id,is_admin,staff_role from users where id=$1',[req.params.id]);
 if(!u||!u.is_admin)return res.status(404).json({error:'not_found'});
 const cur=ROLES.includes(u.staff_role)?u.staff_role:'admin';
 if(RANK[cur]>=RANK[req.staff.role])return res.status(403).json({error:'forbidden_role'});
 await q('update users set is_admin=false,staff_role=null where id=$1',[u.id]);
 await act(req.user.id,u.id,'staff_remove',{role:cur});
 res.json({ok:true})}));
r.get('/tickets',w(async(req,res)=>{
 const st=['open','closed'].includes(req.query.status)?req.query.status:null;
 const rows=await q("select t.id,t.subject,t.topic,t.status,t.created_at,t.updated_at,u.email,(select author from ticket_messages m where m.ticket_id=t.id order by m.id desc limit 1) last_author from tickets t join users u on u.id=t.user_id "+(st?"where t.status=$1 ":"")+"order by t.updated_at desc limit 200",st?[st]:[]);
 res.json(rows)}));
r.get('/tickets/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [t]=await q('select t.id,t.subject,t.topic,t.status,t.created_at,u.email from tickets t join users u on u.id=t.user_id where t.id=$1',[req.params.id]);
 if(!t)return res.status(404).json({error:'not_found'});
 res.json({...t,messages:await q('select id,author,body,created_at from ticket_messages where ticket_id=$1 order by id',[t.id])})}));
r.post('/tickets/:id/reply',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const body=String((req.body||{}).message||'').trim().slice(0,5000);if(!body)return res.status(400).json({error:'invalid_message'});
 const [t]=await q('select t.id,t.subject,t.user_id,u.email,u.lang from tickets t join users u on u.id=t.user_id where t.id=$1',[req.params.id]);
 if(!t)return res.status(404).json({error:'not_found'});
 await q("insert into ticket_messages(ticket_id,author,body) values($1,'staff',$2)",[t.id,body]);
 await q("update tickets set updated_at=now(),status=$2 where id=$1",[t.id,req.body.close?'closed':'open']);
 await notify(t.user_id,'ticket','ticket_reply',t.subject,'/app/help/?t='+t.id);
 try{const BM=require('../brandmail');await BM.send(t.email,{lang:t.lang,subject:SUBJ[t.lang]||SUBJ.en,heading:SUBJ[t.lang]||SUBJ.en,tag:t.subject,paras:[body],cta:{label:CTAH[t.lang]||CTAH.en,url:APP+'/app/help/?t='+t.id}})}catch(e){console.error('ticket mail',e.message)}
 res.json({ok:true})}));
const R=require('../rating');const MA=require('../accountmail');
const PLAN_IDS=['free','pro','business','enterprise'],STATUSES=['active','frozen','blocked'];
async function act(adminId,userId,action,details){await q('insert into admin_actions(admin_id,user_id,action,details) values($1,$2,$3,$4)',[adminId,userId,action,JSON.stringify(details||{})])}
async function setStatus(adminId,u,status,reason){
 const prev=u.status;
 await q('update users set status=$2,status_reason=$3,status_at=now() where id=$1',[u.id,status,status==='active'?null:reason||null]);
 await act(adminId,u.id,'status_'+status,{from:prev,reason:reason||null});
 if(status!==prev){await notify(u.id,'account','account_'+(status==='active'?'unfrozen':status),null,status==='active'?null:'/app/help/tickets/new/','acct:'+u.id+':'+status+':'+Date.now());MA.send(u,status)}
}
r.get('/overview',w(async(req,res)=>{
 const[a]=await q("select count(*)::int total,count(*) filter(where created_at>now()-interval '7 days')::int new7,count(*) filter(where status='frozen')::int frozen,count(*) filter(where status='blocked')::int blocked,count(*) filter(where plan='free')::int free,count(*) filter(where plan='pro')::int pro,count(*) filter(where plan='business')::int business,count(*) filter(where plan='enterprise')::int enterprise,count(*) filter(where tariff='siberia')::int siberia from users");
 const[m]=await q("select coalesce(sum(sent),0)::int sent,coalesce(sum(bounced),0)::int bounced,coalesce(sum(complained),0)::int complained from metric_hours where hr>now()-interval '24 hours'");
 const[x]=await q("select (select count(*)::int from siberia_applications where status='pending') siberia_pending,(select count(*)::int from tickets where status='open') tickets_open,(select count(*)::int from risk_flags where status='open') flags_open");
 res.set('Cache-Control','no-store');res.json({users:a,mail24h:m,queues:x})}));
r.get('/users',w(async(req,res)=>{
 const a=[],w2=[];const qs=String(req.query.q||'').trim().slice(0,100);
 if(qs){a.push('%'+qs.replace(/[\\%_]/g,'\\$&')+'%');w2.push('(u.email ilike $'+a.length+' or u.name ilike $'+a.length+(ID.test(qs)?" or u.id='"+qs+"'":'')+')')}
 if(STATUSES.includes(req.query.status)){a.push(req.query.status);w2.push('u.status=$'+a.length)}
 if(PLAN_IDS.includes(req.query.plan)){a.push(req.query.plan);w2.push('u.plan=$'+a.length)}
 if(req.query.tariff==='siberia')w2.push("u.tariff='siberia'");
 if(req.query.flag==='open')w2.push("exists(select 1 from risk_flags f where f.user_id=u.id and f.status='open')");
 const where=w2.length?' where '+w2.join(' and '):'';
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||50)),off=Math.max(0,parseInt(req.query.offset,10)||0);
 const[c]=await q('select count(*)::int n from users u'+where,a);
 const rows=await q("select u.id,u.email,u.name,u.plan,u.tariff,u.region,u.status,u.is_admin,u.created_at,(select count(*)::int from risk_flags f where f.user_id=u.id and f.status='open') flags from users u"+where+' order by u.created_at desc limit '+lim+' offset '+off,a);
 res.set('Cache-Control','no-store');res.json({total:c.n,data:rows})}));
r.get('/users/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const[u]=await q('select id,email,name,plan,tariff,region,account_country,country,lang,status,status_reason,status_at,is_admin,rating_adjust,onboarded_at,created_at from users where id=$1',[req.params.id]);
 if(!u)return res.status(404).json({error:'not_found'});
 const id=u.id;
 const[cnt]=await q("select (select count(*)::int from domains where user_id=$1) domains,(select count(*)::int from api_keys where user_id=$1 and revoked_at is null) keys,(select count(*)::int from audiences where user_id=$1) audiences,(select count(*)::int from broadcasts where user_id=$1) broadcasts,(select count(*)::int from tickets where user_id=$1) tickets",[id]);
 const[m]=await q("select coalesce(sum(sent),0)::int sent,coalesce(sum(delivered),0)::int delivered,coalesce(sum(bounced),0)::int bounced,coalesce(sum(complained),0)::int complained from metric_hours where user_id=$1 and hr>now()-interval '30 days'",[id]);
 const out={...u,counts:cnt,mail30:m};
 out.sessions=await q('select ip,ua,created_at from sessions where user_id=$1 order by created_at desc limit 15',[id]);
 out.keys=await q('select name,prefix,last_used_at,revoked_at,created_at from api_keys where user_id=$1 order by created_at desc limit 20',[id]);
 out.domains=await q('select name,status,created_at from domains where user_id=$1 order by created_at desc limit 20',[id]);
 out.flags=await q("select f.id,f.kind,f.score,f.status,f.auto_action,f.decision,f.details,f.created_at,f.related_id,(select email from users where id=f.related_id) related_email from risk_flags f where f.user_id=$1 or f.related_id=$1 order by f.created_at desc limit 30",[id]);
 out.actions=await q("select a.action,a.details,a.created_at,(select email from users where id=a.admin_id) admin from admin_actions a where a.user_id=$1 order by a.id desc limit 40",[id]);
 out.applications=await q('select id,status,kind,org_name,inn,region,note,created_at,reviewed_at from siberia_applications where user_id=$1 or lower(email)=lower($2) order by created_at desc limit 10',[id,u.email]);
 out.requests=await q('select method,path,status,ms,ip,created_at from api_logs where user_id=$1 order by id desc limit 25',[id]);
 out.rating=await R.compute(id);
 res.set('Cache-Control','no-store');res.json(out)}));
r.patch('/users/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const[u]=await q('select id,email,lang,status,plan,tariff,is_admin,rating_adjust from users where id=$1',[req.params.id]);
 if(!u)return res.status(404).json({error:'not_found'});
 const b=req.body||{};
 if(u.id===req.user.id&&(b.status!==undefined||b.plan!==undefined))return res.status(409).json({error:'self_change'});
 if(u.is_admin&&b.status!==undefined&&b.status!=='active')return res.status(409).json({error:'admin_protected'});
 if(b.status!==undefined){
  if(!STATUSES.includes(b.status))return res.status(400).json({error:'invalid_status'});
  const reason=String(b.reason||'').trim().slice(0,300)||null;
  if(b.status!==u.status)await setStatus(req.user.id,u,b.status,reason)
 }
 if(b.plan!==undefined){
  if(!PLAN_IDS.includes(b.plan))return res.status(400).json({error:'invalid_plan'});
  if(b.plan!==u.plan){await q('update users set plan=$2 where id=$1',[u.id,b.plan]);await act(req.user.id,u.id,'plan',{from:u.plan,to:b.plan})}
 }
 if(b.rating_adjust!==undefined){
  const n=Number(b.rating_adjust);if(!Number.isInteger(n)||n<-100||n>100)return res.status(400).json({error:'invalid_adjust'});
  if(n!==u.rating_adjust){await q('update users set rating_adjust=$2 where id=$1',[u.id,n]);await act(req.user.id,u.id,'rating_adjust',{from:u.rating_adjust,to:n,note:String(b.note||'').slice(0,300)||null})}
 }
 if(b.note!==undefined&&b.status===undefined&&b.plan===undefined&&b.rating_adjust===undefined){
  const note=String(b.note||'').trim().slice(0,1000);if(note)await act(req.user.id,u.id,'note',{note})
 }
 res.json({ok:true})}));
r.get('/risk',w(async(req,res)=>{
 const st=['open','reviewed','dismissed'].includes(req.query.status)?req.query.status:'open';
 const rows=await q("select f.id,f.kind,f.score,f.status,f.auto_action,f.decision,f.details,f.created_at,f.user_id,u.email,u.status user_status,u.plan,f.related_id,o.email related_email,o.status related_status from risk_flags f join users u on u.id=f.user_id left join users o on o.id=f.related_id where f.status=$1 order by f.score desc,f.created_at desc limit 200",[st]);
 res.json(rows)}));
r.patch('/risk/:id',w(async(req,res)=>{
 if(!/^\d{1,18}$/.test(req.params.id))return res.status(404).json({error:'not_found'});
 const d=String((req.body||{}).decision||'');
 if(!['dismiss','confirm','block'].includes(d))return res.status(400).json({error:'invalid_decision'});
 const[f]=await q('select * from risk_flags where id=$1',[req.params.id]);
 if(!f)return res.status(404).json({error:'not_found'});
 if(f.status!=='open')return res.status(409).json({error:'already_decided'});
 const[u]=await q('select id,email,lang,status,status_reason,is_admin from users where id=$1',[f.user_id]);
 if(d==='dismiss'&&u.status==='frozen'&&u.status_reason==='multi_account_review')await setStatus(req.user.id,u,'active',null);
 if(d==='block'){if(u.is_admin)return res.status(409).json({error:'admin_protected'});if(u.status!=='blocked')await setStatus(req.user.id,u,'blocked',f.kind)}
 await q("update risk_flags set status=$2,decision=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() where id=$1",[f.id,d==='dismiss'?'dismissed':'reviewed',d,req.user.id]);
 await act(req.user.id,u.id,'risk_'+d,{flag:f.id,kind:f.kind,score:f.score});
 res.json({ok:true})}));
r.get('/rating-rules',w(async(req,res)=>res.json({rules:await R.rules(),defaults:R.DEFAULTS})));
r.put('/rating-rules',w(async(req,res)=>{
 const v=await R.save(req.body&&req.body.rules);
 if(!v.ok)return res.status(400).json({error:'invalid',fields:v.errors});
 await act(req.user.id,null,'rating_rules',{});
 res.json({ok:true})}));
r.post('/rating-rules/reset',w(async(req,res)=>{await R.reset();await act(req.user.id,null,'rating_rules_reset',{});res.json({ok:true})}));
r.get('/siberia',w(async(req,res)=>{
 const st=['pending','approved','rejected','revoked'].includes(req.query.status)?req.query.status:null;
 const rows=await q("select a.*,u.name,u.tariff from siberia_applications a left join users u on u.id=a.user_id "+(st?"where a.status=$1 ":"")+"order by (a.status='pending') desc,a.created_at desc limit 200",st?[st]:[]);
 res.json(rows)}));
r.patch('/siberia/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const st=String(req.body.status||''),note=String(req.body.note||'').trim().slice(0,500)||null;
 if(!['approved','rejected','revoked'].includes(st))return res.status(400).json({error:'invalid_status'});
 const[a]=await q('select * from siberia_applications where id=$1',[req.params.id]);
 if(!a)return res.status(404).json({error:'not_found'});
 const ok=(a.status==='pending'&&(st==='approved'||st==='rejected'))||(a.status==='approved'&&st==='revoked');
 if(!ok)return res.status(409).json({error:'bad_transition'});
 await q('update siberia_applications set status=$2,note=$3,reviewer=$4,reviewed_at=now() where id=$1',[a.id,st,note,req.user.id]);
 let uid=a.user_id;
 if(st==='approved'){const[u]=await q("update users set tariff='siberia' where lower(email)=lower($1) returning id",[a.email]);if(u){uid=u.id;await q('update siberia_applications set user_id=$2 where id=$1',[a.id,u.id])}}
 if(st==='revoked')await q("update users set tariff='standard' where lower(email)=lower($1)",[a.email]);
 if(uid)await notify(uid,'billing','siberia_'+st,note,'/app/settings/billing/','siberia:'+a.id+':'+st);
 require('../siberiamail').send(a,st,note);
 res.json({ok:true,status:st,attached:!!uid})}));
const SSO=require('../sso');const {enc}=require('../secret');
const DOM=/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ssoView=x=>({domain:x.domain,issuer:x.issuer,client_id:x.client_id,enabled:x.enabled,created_at:x.created_at});
const cleanDomain=v=>String(v||'').trim().toLowerCase().replace(/^@/,'');
const cleanIssuer=v=>String(v||'').trim().replace(/\/+$/,'');
r.get('/sso',w(async(req,res)=>{
 res.json({redirect_uri:APP+'/api/auth/sso/callback',items:(await q('select domain,issuer,client_id,enabled,created_at from sso_connections order by created_at desc')).map(ssoView)})}));
r.post('/sso/check',w(async(req,res)=>{
 const issuer=cleanIssuer((req.body||{}).issuer);
 if(!/^https:\/\//.test(issuer)&&!process.env.SSO_ALLOW_HTTP)return res.status(400).json({error:'invalid_issuer'});
 try{const d=await SSO.discover(issuer);res.json({ok:true,authorization_endpoint:d.authorization_endpoint,token_endpoint:d.token_endpoint})}
 catch(e){res.status(502).json({ok:false,error:e.message})}}));
r.post('/sso',w(async(req,res)=>{
 const b=req.body||{},domain=cleanDomain(b.domain),issuer=cleanIssuer(b.issuer),cid=String(b.client_id||'').trim().slice(0,300),sec=String(b.client_secret||'').trim().slice(0,2000);
 if(!DOM.test(domain))return res.status(400).json({error:'invalid_domain'});
 if(!/^https:\/\/[^\s]+$/.test(issuer)&&!(process.env.SSO_ALLOW_HTTP&&/^http:\/\/[^\s]+$/.test(issuer)))return res.status(400).json({error:'invalid_issuer'});
 if(!cid||!sec)return res.status(400).json({error:'invalid_credentials'});
 const[ex]=await q('select 1 from sso_connections where domain=$1',[domain]);
 if(ex)return res.status(409).json({error:'sso_exists'});
 try{await SSO.discover(issuer)}catch(e){return res.status(502).json({error:e.message})}
 const[x]=await q('insert into sso_connections(domain,issuer,client_id,client_secret_enc,enabled) values($1,$2,$3,$4,true) returning domain,issuer,client_id,enabled,created_at',[domain,issuer,cid,enc(sec)]);
 await act(req.user.id,null,'sso_add',{domain,issuer});
 res.status(201).json(ssoView(x))}));
r.patch('/sso/:domain',w(async(req,res)=>{
 const domain=cleanDomain(req.params.domain),b=req.body||{};
 const[cur]=await q('select * from sso_connections where domain=$1',[domain]);
 if(!cur)return res.status(404).json({error:'not_found'});
 let issuer=cur.issuer,cid=cur.client_id,secEnc=cur.client_secret_enc,en=cur.enabled;
 if(b.enabled!=null)en=!!b.enabled;
 if(b.issuer!=null){issuer=cleanIssuer(b.issuer);if(!/^https:\/\/[^\s]+$/.test(issuer)&&!(process.env.SSO_ALLOW_HTTP&&/^http:\/\/[^\s]+$/.test(issuer)))return res.status(400).json({error:'invalid_issuer'});if(issuer!==cur.issuer){try{await SSO.discover(issuer)}catch(e){return res.status(502).json({error:e.message})}}}
 if(b.client_id!=null){cid=String(b.client_id).trim().slice(0,300);if(!cid)return res.status(400).json({error:'invalid_credentials'})}
 if(b.client_secret){secEnc=enc(String(b.client_secret).trim().slice(0,2000))}
 const[x]=await q('update sso_connections set issuer=$2,client_id=$3,client_secret_enc=$4,enabled=$5 where domain=$1 returning domain,issuer,client_id,enabled,created_at',[domain,issuer,cid,secEnc,en]);
 await act(req.user.id,null,b.enabled!=null&&Object.keys(b).length===1?(en?'sso_enable':'sso_disable'):'sso_update',{domain});
 res.json(ssoView(x))}));
r.delete('/sso/:domain',w(async(req,res)=>{
 const domain=cleanDomain(req.params.domain);
 const[x]=await q('delete from sso_connections where domain=$1 returning domain',[domain]);
 if(!x)return res.status(404).json({error:'not_found'});
 await q('delete from oauth_accounts where provider=$1',['sso:'+domain]);
 await act(req.user.id,null,'sso_delete',{domain});
 res.json({ok:true})}));
const MT=require('../maintenance');
r.get('/maintenance',w(async(req,res)=>{MT.reset();const m=await MT.get();res.set('Cache-Control','no-store');res.json(m)}));
r.put('/maintenance',w(async(req,res)=>{
 const b=req.body||{};const active=!!b.active;const scope=b.scope==='sending'?'sending':'all';
 const title=String(b.title||'').trim().slice(0,120),message=String(b.message||'').trim().slice(0,1000);
 let eta=null;if(b.eta){const d=new Date(b.eta);if(isNaN(d.getTime()))return res.status(422).json({error:'bad_eta'});eta=d.toISOString()}
 await q('update maintenance set active=$1,scope=$2,title=$3,message=$4,eta=$5,updated_at=now(),updated_by=$6 where id=1',[active,scope,title,message,eta,req.user.id]);
 await act(req.user.id,null,active?'maintenance_on':'maintenance_off',{scope,title,eta});
 MT.reset();res.json({ok:true,...(await MT.get())})}));
r.get('/maintenance/notice',w(async(req,res)=>{res.set('Cache-Control','no-store');res.json(await MT.getNotice())}));
r.put('/maintenance/notice',w(async(req,res)=>{
 const b=req.body||{};const texts=MT.cleanTexts(b.texts);
 if(b.active&&!Object.keys(texts).length)return res.status(422).json({error:'notice_empty'});
 const d=v=>{if(!v)return null;const x=new Date(v);return isNaN(x.getTime())?undefined:x.toISOString()};
 const st=d(b.starts_at),en=d(b.ends_at);
 if(st===undefined||en===undefined)return res.status(422).json({error:'bad_eta'});
 if(st&&en&&new Date(en)<=new Date(st))return res.status(422).json({error:'bad_eta'});
 await q('update maintenance_notice set active=$1,texts=$2,starts_at=$3,ends_at=$4,updated_at=now(),updated_by=$5 where id=1',[!!b.active,JSON.stringify(texts),st,en,req.user.id]);
 await act(req.user.id,null,b.active?'notice_on':'notice_off',{starts_at:st,ends_at:en});
 res.json(await MT.getNotice())}));
r.post('/maintenance/notice/email',w(async(req,res)=>{
 const n=await MT.getNotice();
 if(!Object.keys(n.texts||{}).length)return res.status(422).json({error:'notice_empty'});
 const BM=require('../brandmail');
 const CTA={en:'Open the status page',ru:'Открыть страницу статуса',fr:'Ouvrir la page d’état',de:'Statusseite öffnen'};
 const TAG={en:'Planned maintenance',ru:'Плановые технические работы',fr:'Maintenance planifiée',de:'Geplante Wartung'};
 const WHEN={en:'When',ru:'Когда',fr:'Quand',de:'Wann'};
 const users=await q("select id,email,lang from users where status<>'blocked' and email is not null and email<>''");
 let sent=0,failed=0;
 const fmt=(v,l)=>v?new Date(v).toLocaleString({ru:'ru-RU',fr:'fr-FR',de:'de-DE',en:'en-GB'}[l]||'en-GB',{timeZone:'UTC',dateStyle:'long',timeStyle:'short'})+' UTC':'';
 for(const u of users){
  const l=MT.LANGS.includes(u.lang)?u.lang:'en',x=MT.pick(n.texts,l);
  const when=n.starts_at?WHEN[l]+': '+fmt(n.starts_at,l)+(n.ends_at?' – '+fmt(n.ends_at,l):''):'';
  try{await BM.send(u.email,{lang:l,subject:x.title||TAG[l],heading:x.title||TAG[l],tag:TAG[l],paras:[x.message,when],cta:{label:CTA[l],url:APP+'/status/'}});sent++}catch(e){failed++}
  await q("insert into notifications(user_id,type,title,body,link,dedupe) values($1,'maintenance',$2,$3,'/status/',$4) on conflict do nothing",[u.id,String(x.title||TAG[l]).slice(0,160),String(x.message||'').slice(0,500),'mt:'+new Date(n.updated_at||Date.now()).getTime()]).catch(()=>{});
 }
 await q('update maintenance_notice set emailed_at=now(),emailed_count=$1 where id=1',[sent]);
 await act(req.user.id,null,'notice_email',{sent,failed});
 res.json({ok:true,sent,failed})}));
r.get('/incidents',w(async(req,res)=>res.json(await q('select * from incidents order by started_at desc limit 100'))));
r.post('/incidents',w(async(req,res)=>{
 const b=req.body||{},title=String(b.title||'').trim().slice(0,160);if(!title)return res.status(400).json({error:'invalid_title'});
 const [i]=await q('insert into incidents(title,body,component,status,impact) values($1,$2,$3,$4,$5) returning *',[title,String(b.body||'').slice(0,2000)||null,String(b.component||'').slice(0,40)||null,['investigating','identified','monitoring'].includes(b.status)?b.status:'investigating',['minor','major','critical'].includes(b.impact)?b.impact:'minor']);
 res.status(201).json(i)}));
r.patch('/incidents/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const b=req.body||{},st=['investigating','identified','monitoring','resolved'].includes(b.status)?b.status:null;
 const [i]=await q("update incidents set status=coalesce($2,status),body=coalesce($3,body),resolved_at=case when $2='resolved' then now() else resolved_at end where id=$1 returning *",[req.params.id,st,b.body==null?null:String(b.body).slice(0,2000)]);
 i?res.json(i):res.status(404).json({error:'not_found'})}));


r.get('/analytics',w(async(req,res)=>{
 res.set('Cache-Control','no-store');
 const days=Math.max(1,Math.min(90,parseInt(req.query.days,10)||7));const since=`now()-interval '${days} days'`;
 const [tot]=await q(`select count(*) filter(where kind='view')::int views,count(distinct sid)::int visitors,count(*) filter(where kind='click')::int clicks from page_events where ts>${since}`);
 const pages=await q(`select path,count(*)::int views,count(distinct sid)::int visitors from page_events where kind='view' and ts>${since} group by path order by views desc limit 15`);
 const countries=await q(`select country,count(distinct sid)::int visitors,count(*) filter(where kind='view')::int views from page_events where ts>${since} and country<>'' group by country order by visitors desc limit 15`);
 const clicks=await q(`select path,label,count(*)::int n from page_events where kind='click' and ts>${since} and label<>'' group by path,label order by n desc limit 20`);
 const series=await q(`select to_char(date_trunc('day',ts),'YYYY-MM-DD') d,count(*) filter(where kind='view')::int views,count(distinct sid)::int visitors from page_events where ts>${since} group by 1 order by 1`);
 const devices=await q(`select device,count(distinct sid)::int visitors from page_events where ts>${since} group by device`);
 const refs=await q(`select ref,count(distinct sid)::int visitors from page_events where kind='view' and ts>${since} and ref<>'' group by ref order by visitors desc limit 10`);
 res.json({days,totals:tot,pages,countries,clicks,series,devices,refs})
}));
module.exports=r;
