const r=require('express').Router();const {q}=require('../db');const {w}=require('../auth');const S=require('../siberia');const M=require('../siberiamail');
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>3600000)hits.delete(k)},600000).unref();
r.post('/apply',w(async(req,res)=>{
 const b=req.body||{};
 if(b.website)return res.json({ok:true});
 const k=req.ip,h=hits.get(k)||{t:Date.now(),n:0};if(Date.now()-h.t>3600000){h.t=Date.now();h.n=0}
 if(h.n>=5)return res.status(429).json({error:'rate_limited'});h.n++;hits.set(k,h);
 const v=S.validate(b);
 if(!v.ok)return res.status(400).json({error:'invalid',fields:v.fields});
 const x=v.value;
 const[ap]=await q("select 1 from siberia_applications where lower(email)=$1 and status='approved' limit 1",[x.email]);
 if(ap)return res.status(409).json({error:'already_approved'});
 try{
  const[u]=await q('select id from users where lower(email)=$1',[x.email]);
  const[a]=await q('insert into siberia_applications(user_id,email,lang,kind,org_name,inn,region,site,phone,purpose) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,email,lang,org_name',[u?u.id:null,x.email,x.lang,x.kind,x.org_name,x.inn,x.region,x.site||null,x.phone||null,x.purpose]);
  M.send(a,'received');
  res.status(201).json({ok:true})
 }catch(e){if(e.code==='23505')return res.status(409).json({error:'pending_exists'});throw e}
}));
module.exports=r;
