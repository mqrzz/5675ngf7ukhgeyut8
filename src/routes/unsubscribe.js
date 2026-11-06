const r=require('express').Router();const {q}=require('../db');const {w}=require('../auth');const B=require('../broadcast');
function mask(e){const[l,d]=String(e).split('@');return(l.length>2?l.slice(0,2):l.slice(0,1))+'***@'+d}
async function find(t){const id=B.verify(t);if(!id)return null;const[c]=await q('select c.id,c.email,c.unsubscribed,c.audience_id,a.name audience,a.user_id owner from contacts c join audiences a on a.id=c.audience_id where c.id=$1',[id]);return c||null}
r.get('/:token',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 const[s]=await q("select s.bg,s.tx,s.accent,(s.hide_branding and u.plan<>'free') hide from unsub_style s join users u on u.id=s.user_id where s.user_id=$1",[c.owner]);
 const topics=await q('select t.id,t.name,t.description,coalesce(ct.subscribed,t.default_on) subscribed from topics t left join contact_topics ct on ct.topic_id=t.id and ct.contact_id=$2 where t.audience_id=$1 order by t.created_at',[c.audience_id,c.id]);
 res.json({email:mask(c.email),audience:c.audience,unsubscribed:c.unsubscribed,topics,style:s?{bg:s.bg,tx:s.tx,accent:s.accent,hide:s.hide}:null})
}));
r.post('/:token',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 await q('update contacts set unsubscribed=true,unsubscribed_at=coalesce(unsubscribed_at,now()) where id=$1',[c.id]);
 res.json({ok:true,unsubscribed:true})
}));
r.post('/:token/topics',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 const tid=String(req.body.topic_id||'');if(!/^[0-9a-f-]{36}$/i.test(tid))return res.status(400).json({error:'invalid_topic'});
 const[t]=await q('select id from topics where id=$1 and audience_id=$2',[tid,c.audience_id]);if(!t)return res.status(404).json({error:'topic_not_found'});
 await q('insert into contact_topics(topic_id,contact_id,subscribed) values($1,$2,$3) on conflict(topic_id,contact_id) do update set subscribed=$3',[tid,c.id,!!req.body.subscribed]);
 res.json({ok:true,subscribed:!!req.body.subscribed})
}));
r.post('/:token/resubscribe',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 await q('update contacts set unsubscribed=false,unsubscribed_at=null where id=$1',[c.id]);
 res.json({ok:true,unsubscribed:false})
}));
module.exports=r;
