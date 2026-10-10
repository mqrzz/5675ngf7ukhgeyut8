const r=require('express').Router();const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const M=require('../metrics');
r.use(need,sessionOnly);
r.get('/',w(async(req,res)=>{
 const[u]=await q('select plan from users where id=$1',[req.user.id]);
 let domain=String(req.query.domain||'').toLowerCase();if(domain==='all'||!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain))domain='';
 res.set('Cache-Control','no-store');
 res.json(await M.report(req.user.id,u.plan,parseInt(req.query.days,10),domain))
}));
module.exports=r;
