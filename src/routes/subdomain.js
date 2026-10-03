const r=require('express').Router();const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const PLANS=require('../plans');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const RESERVED=new Set(['www','mail','smtp','imap','pop','api','app','admin','root','postmaster','abuse','security','support','noreply','no-reply','billing','status','docs','blog','help','ftp','ns1','ns2','dns','mx','email','send','geserd','dashboard','login','signup','test','demo']);
const RX=/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
r.use(need);
r.get('/',w(async(req,res)=>{const [{plan}]=await q('select plan from users where id=$1',[req.user.id]);
 const rows=await q('select slug,created_at from subdomains where user_id=$1 order by created_at',[req.user.id]);
 res.json({base:BASE,limit:(PLANS[plan]||PLANS.free).subdomains,items:rows.map(x=>({slug:x.slug,domain:x.slug+'.'+BASE,created_at:x.created_at}))})}));
r.post('/',sessionOnly,w(async(req,res)=>{
 const slug=String(req.body.slug||'').trim().toLowerCase();
 if(!RX.test(slug)||slug.includes('--'))return res.status(400).json({error:'invalid_slug'});
 if(RESERVED.has(slug))return res.status(409).json({error:'reserved'});
 const [{plan}]=await q('select plan from users where id=$1',[req.user.id]);
 const n=(await q('select count(*)::int n from subdomains where user_id=$1',[req.user.id]))[0].n;
 if(n>=(PLANS[plan]||PLANS.free).subdomains)return res.status(403).json({error:'plan_limit'});
 try{await q('insert into subdomains(slug,user_id) values($1,$2)',[slug,req.user.id])}catch(e){if(e.code==='23505')return res.status(409).json({error:'taken'});throw e}
 res.status(201).json({slug,domain:slug+'.'+BASE});
}));
r.get('/check/:slug',w(async(req,res)=>{const s=String(req.params.slug).toLowerCase();
 if(!RX.test(s)||s.includes('--'))return res.json({available:false,reason:'invalid'});
 if(RESERVED.has(s))return res.json({available:false,reason:'reserved'});
 res.json({available:!(await q('select 1 from subdomains where slug=$1',[s])).length})}));
r.delete('/:slug',sessionOnly,w(async(req,res)=>{await q('delete from subdomains where slug=$1 and user_id=$2',[String(req.params.slug).toLowerCase(),req.user.id]);res.json({ok:true})}));
module.exports=r;
