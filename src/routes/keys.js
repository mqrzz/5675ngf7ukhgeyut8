const r=require('express').Router();const c=require('crypto');const {q}=require('../db');const {w,need,sessionOnly,sha}=require('../auth');const PLANS=require('../plans');
r.use(need,sessionOnly);
r.get('/',w(async(req,res)=>res.json(await q('select k.id,k.name,k.prefix,k.created_at,k.last_used_at,k.permission,k.domain_id,d.name domain from api_keys k left join domains d on d.id=k.domain_id where k.user_id=$1 and k.revoked_at is null order by k.created_at desc',[req.user.id]))));
r.post('/',w(async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,60)||'Untitled';
 const perm=req.body.permission==='sending'?'sending':'full';let dom=null;
 if(req.body.domain_id){if(!/^[0-9a-f-]{36}$/i.test(String(req.body.domain_id)))return res.status(400).json({error:'bad_domain'});const [dr]=await q('select id from domains where id=$1 and user_id=$2',[req.body.domain_id,req.user.id]);if(!dr)return res.status(400).json({error:'bad_domain'});dom=dr.id}
 const [{plan}]=await q('select eff_plan(plan,tariff) plan from users where id=$1',[req.user.id]);
 const n=(await q('select count(*)::int n from api_keys where user_id=$1 and revoked_at is null',[req.user.id]))[0].n;if(n>=(PLANS[plan]||PLANS.free).keys)return res.status(403).json({error:'plan_limit'});
 const key='gs_'+c.randomBytes(24).toString('base64url');
 const [row]=await q('insert into api_keys(user_id,name,prefix,key_hash,permission,domain_id) values($1,$2,$3,$4,$5,$6) returning id,name,prefix,created_at,permission,domain_id',[req.user.id,name,key.slice(0,10),sha(key),perm,dom]);
 res.status(201).json({...row,key})}));
r.delete('/:id',w(async(req,res)=>{await q('update api_keys set revoked_at=now() where id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
module.exports=r;
