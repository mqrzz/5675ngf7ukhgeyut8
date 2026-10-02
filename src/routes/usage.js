// GET /api/usage — real numbers for Settings > Usage (plan limits from plans.js + what the account used).
const r=require('express').Router();const {q}=require('../db');const {w,need}=require('../auth');const PLANS=require('../plans');
r.use(need);
r.get('/',w(async(req,res)=>{
 const uid=req.user.id,[{plan}]=await q('select plan from users where id=$1',[uid]),P=PLANS[plan]||PLANS.free;
 const [m]=await q("select coalesce(sum(jsonb_array_length(to_addrs)) filter(where direction='out' and created_at>=date_trunc('month',now())),0)::int out_m,coalesce(sum(jsonb_array_length(to_addrs)) filter(where direction='out' and created_at>=date_trunc('day',now())),0)::int out_d,count(*) filter(where direction='in' and created_at>=date_trunc('month',now()))::int in_m from emails where user_id=$1 and status<>'rejected'",[uid]);
 const one=async t=>(await q('select count(*)::int n from '+t+' where user_id=$1'+(t==='api_keys'?' and revoked_at is null':''),[uid]))[0].n;
 res.json({plan,limits:P,used:{monthly:m.out_m,daily:m.out_d,inbound:m.in_m,domains:await one('domains'),keys:await one('api_keys'),webhooks:await one('webhooks'),subdomains:await one('subdomains')}});
}));
module.exports=r;
