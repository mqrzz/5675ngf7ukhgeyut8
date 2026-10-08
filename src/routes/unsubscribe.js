const r=require('express').Router();const {q}=require('../db');const {w}=require('../auth');const B=require('../broadcast');
function mask(e){const[l,d]=String(e).split('@');return(l.length>2?l.slice(0,2):l.slice(0,1))+'***@'+d}
async function find(t){const id=B.verify(t);if(!id)return null;const[c]=await q('select c.id,c.email,c.unsubscribed,a.name audience from contacts c join audiences a on a.id=c.audience_id where c.id=$1',[id]);return c||null}
r.get('/:token',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 res.json({email:mask(c.email),audience:c.audience,unsubscribed:c.unsubscribed})
}));
r.post('/:token',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 await q('update contacts set unsubscribed=true,unsubscribed_at=coalesce(unsubscribed_at,now()) where id=$1',[c.id]);
 res.json({ok:true,unsubscribed:true})
}));
r.post('/:token/resubscribe',w(async(req,res)=>{
 const c=await find(req.params.token);res.set('Cache-Control','no-store');
 if(!c)return res.status(404).json({error:'invalid_link'});
 await q('update contacts set unsubscribed=false,unsubscribed_at=null where id=$1',[c.id]);
 res.json({ok:true,unsubscribed:false})
}));
module.exports=r;
