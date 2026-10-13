const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const {notify}=require('../notify');const {transport,FROM}=require('../mailer');
const ID=/^[0-9a-f-]{36}$/i;
const SUBJ={en:'Geserd support replied to your ticket',ru:'Поддержка Geserd ответила на ваше обращение',fr:'Le support Geserd a répondu à votre demande',de:'Der Geserd-Support hat auf Ihre Anfrage geantwortet'};
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
r.use(need,sessionOnly,w(async(req,res,next)=>{const [u]=await q('select is_admin from users where id=$1',[req.user.id]);if(!u||!u.is_admin)return res.status(403).json({error:'forbidden'});next()}));
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
 try{await transport.sendMail({from:{name:'Geserd',address:FROM},to:t.email,subject:SUBJ[t.lang]||SUBJ.en,text:body+'\n\n'+APP+'/app/help/?t='+t.id,headers:{'Auto-Submitted':'auto-generated'}})}catch(e){console.error('ticket mail',e.message)}
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
module.exports=r;
