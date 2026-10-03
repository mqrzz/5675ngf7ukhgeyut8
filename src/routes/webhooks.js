const r=require('express').Router();const c=require('crypto');
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const PLANS=require('../plans');
const {EVENTS}=require('../events');const {safeTarget,post}=require('../webhooks');
r.use(need,sessionOnly);
const pub=h=>({id:h.id,url:h.url,events:h.events,active:h.active,created_at:h.created_at});
const own=w(async(req,res,next)=>{if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [h]=await q('select * from webhooks where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!h)return res.status(404).json({error:'not_found'});req.h=h;next()});
function cleanEvents(v){if(v==null)return[];if(!Array.isArray(v))return null;const s=[...new Set(v.map(String))];return s.every(x=>EVENTS.includes(x))?(s.length===EVENTS.length?[]:s):null}
r.get('/events',(_,res)=>res.json(EVENTS));
r.get('/',w(async(req,res)=>res.json((await q('select * from webhooks where user_id=$1 order by created_at desc',[req.user.id])).map(pub))));
r.post('/',w(async(req,res)=>{
 const url=String(req.body.url||'').trim();const ev=cleanEvents(req.body.events);
 if(ev===null)return res.status(400).json({error:'invalid_events'});
 if(url.length>2000||!/^https?:\/\//i.test(url)||!(await safeTarget(url)))return res.status(400).json({error:'invalid_url'});
 const [{plan}]=await q('select plan from users where id=$1',[req.user.id]);
 const n=(await q('select count(*)::int n from webhooks where user_id=$1',[req.user.id]))[0].n;if(n>=(PLANS[plan]||PLANS.free).webhooks)return res.status(403).json({error:'plan_limit'});
 const secret='whsec_'+c.randomBytes(24).toString('base64url');
 const [h]=await q('insert into webhooks(user_id,url,secret,events) values($1,$2,$3,$4) returning *',[req.user.id,url,secret,ev]);
 res.status(201).json({...pub(h),secret})}));
r.get('/:id',own,w(async(req,res)=>{
 const d=await q('select id,event,status,attempts,last_status,last_error,created_at,delivered_at from webhook_deliveries where webhook_id=$1 order by created_at desc limit 25',[req.h.id]);
 res.json({...pub(req.h),secret:req.h.secret,deliveries:d})}));
r.patch('/:id',own,w(async(req,res)=>{
 let {url,events,active}=req.body||{};const set=[],a=[req.h.id];
 if(url!==undefined){url=String(url).trim();if(url.length>2000||!(await safeTarget(url)))return res.status(400).json({error:'invalid_url'});a.push(url);set.push('url=$'+a.length)}
 if(events!==undefined){const e=cleanEvents(events);if(e===null)return res.status(400).json({error:'invalid_events'});a.push(e);set.push('events=$'+a.length)}
 if(active!==undefined){a.push(!!active);set.push('active=$'+a.length)}
 if(!set.length)return res.json(pub(req.h));
 const [h]=await q('update webhooks set '+set.join(',')+' where id=$1 returning *',a);res.json(pub(h))}));
r.post('/:id/rotate',own,w(async(req,res)=>{const secret='whsec_'+c.randomBytes(24).toString('base64url');await q('update webhooks set secret=$2 where id=$1',[req.h.id,secret]);res.json({secret})}));
r.post('/:id/test',own,w(async(req,res)=>{
 const payload={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'00000000-0000-0000-0000-000000000000',from:'hello@example.com',to:['test@example.com'],subject:'Geserd test event',test:true}};
 const [d]=await q("insert into webhook_deliveries(webhook_id,event,payload,status,attempts) values($1,'email.delivered',$2,'pending',0) returning id",[req.h.id,JSON.stringify(payload)]);
 const o=await post(req.h,{id:d.id,payload});
 await q("update webhook_deliveries set status=$2,attempts=1,last_status=$3,last_error=$4,delivered_at=case when $2='delivered' then now() end,next_at=now() where id=$1",[d.id,o.ok?'delivered':'failed',o.status||null,o.error||null]);
 res.json({ok:o.ok,status:o.status||null,error:o.error||null})}));
r.delete('/:id',own,w(async(req,res)=>{await q('delete from webhooks where id=$1',[req.h.id]);res.json({ok:true})}));
module.exports=r;
