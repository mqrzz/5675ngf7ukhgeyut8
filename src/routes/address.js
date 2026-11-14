const r=require('express').Router();const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const PLANS=require('../plans');
const SH=require('../shared');
r.use(need);
async function limitOf(uid){const [{plan}]=await q('select eff_plan(plan,tariff) plan from users where id=$1',[uid]);return(PLANS[plan]||PLANS.free).subdomains}
r.get('/',w(async(req,res)=>{
 const rows=await q('select handle,created_at from handles where user_id=$1 order by created_at',[req.user.id]);
 res.json({domain:SH.SHARED,limit:await limitOf(req.user.id),items:rows.map(x=>({handle:x.handle,address:x.handle+'@'+SH.SHARED,created_at:x.created_at}))})}));
r.post('/',sessionOnly,w(async(req,res)=>{
 const h=String(req.body.handle||'').trim().toLowerCase();
 if(!SH.valid(h))return res.status(400).json({error:'invalid_handle'});
 if(SH.RESERVED.has(h))return res.status(409).json({error:'reserved'});
 const n=(await q('select count(*)::int n from handles where user_id=$1',[req.user.id]))[0].n;
 if(n>=await limitOf(req.user.id))return res.status(403).json({error:'plan_limit'});
 try{await q('insert into handles(handle,user_id) values($1,$2)',[h,req.user.id])}catch(e){if(e.code==='23505')return res.status(409).json({error:'taken'});throw e}
 res.status(201).json({handle:h,address:h+'@'+SH.SHARED})}));
r.get('/check/:handle',w(async(req,res)=>{
 const h=String(req.params.handle).toLowerCase();
 if(!SH.valid(h))return res.json({available:false,reason:'invalid'});
 if(SH.RESERVED.has(h))return res.json({available:false,reason:'reserved'});
 res.json({available:!(await q('select 1 from handles where handle=$1',[h])).length})}));
r.delete('/:handle',sessionOnly,w(async(req,res)=>{await q('delete from handles where handle=$1 and user_id=$2',[String(req.params.handle).toLowerCase(),req.user.id]);res.json({ok:true})}));
module.exports=r;
