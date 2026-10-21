const r=require('express').Router();
const {w,need}=require('../auth');const A=require('../automation');
r.use(need);
r.post('/',w(async(req,res)=>{
 const b=req.body||{};const name=String(b.name||'').trim();const email=String(b.email||'').trim();
 if(!/^[a-z0-9._:-]{1,80}$/i.test(name))return res.status(422).json({error:'invalid_event'});
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>320)return res.status(422).json({error:'invalid_email'});
 const data={};if(b.data&&typeof b.data==='object')for(const [k,v] of Object.entries(b.data).slice(0,30))if(/^[a-z0-9_]{1,40}$/i.test(k)&&['string','number'].includes(typeof v))data[k]=String(v).slice(0,500);
 res.json({started:await A.fire(req.user.id,name,email,data)})}));
module.exports=r;
