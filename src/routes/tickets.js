const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');
const TOPICS=['general','billing','deliverability','domains','api','abuse','feedback','other'];
const ID=/^[0-9a-f-]{36}$/i;
r.use(need,sessionOnly);
const clean=(s,n)=>String(s==null?'':s).replace(/\u0000/g,'').trim().slice(0,n);
r.get('/',w(async(req,res)=>{
 const rows=await q("select t.id,t.subject,t.topic,t.status,t.created_at,t.updated_at,(select count(*)::int from ticket_messages m where m.ticket_id=t.id) messages,(select author from ticket_messages m where m.ticket_id=t.id order by m.id desc limit 1) last_author from tickets t where t.user_id=$1 order by t.updated_at desc limit 100",[req.user.id]);
 res.json(rows)}));
r.post('/',w(async(req,res)=>{
 const b=req.body||{},subject=clean(b.subject,160),body=clean(b.message,5000),topic=TOPICS.includes(b.topic)?b.topic:'other';
 if(subject.length<3)return res.status(400).json({error:'invalid_subject'});
 if(body.length<5)return res.status(400).json({error:'invalid_message'});
 const [{n}]=await q("select count(*)::int n from tickets where user_id=$1 and status<>'closed'",[req.user.id]);
 if(n>=5)return res.status(429).json({error:'too_many_tickets'});
 const [{d}]=await q("select count(*)::int d from tickets where user_id=$1 and created_at>now()-interval '1 day'",[req.user.id]);
 if(d>=10)return res.status(429).json({error:'rate_limited'});
 const [t]=await q('insert into tickets(user_id,subject,topic) values($1,$2,$3) returning id,subject,topic,status,created_at,updated_at',[req.user.id,subject,topic]);
 await q("insert into ticket_messages(ticket_id,author,body) values($1,'user',$2)",[t.id,body]);
 res.status(201).json(t)}));
const own=w(async(req,res,next)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [t]=await q('select id,subject,topic,status,created_at,updated_at from tickets where id=$1 and user_id=$2',[req.params.id,req.user.id]);
 if(!t)return res.status(404).json({error:'not_found'});req.t=t;next()});
r.get('/:id',own,w(async(req,res)=>{
 const m=await q('select id,author,body,created_at from ticket_messages where ticket_id=$1 order by id',[req.t.id]);
 res.json({...req.t,messages:m})}));
r.post('/:id/messages',own,w(async(req,res)=>{
 const body=clean((req.body||{}).message,5000);if(body.length<1)return res.status(400).json({error:'invalid_message'});
 if(req.t.status==='closed')return res.status(409).json({error:'ticket_closed'});
 const [{n}]=await q("select count(*)::int n from ticket_messages where ticket_id=$1 and author='user' and created_at>now()-interval '1 hour'",[req.t.id]);
 if(n>=20)return res.status(429).json({error:'rate_limited'});
 const [m]=await q("insert into ticket_messages(ticket_id,author,body) values($1,'user',$2) returning id,author,body,created_at",[req.t.id,body]);
 await q("update tickets set updated_at=now(),status='open' where id=$1",[req.t.id]);
 res.status(201).json(m)}));
r.post('/:id/close',own,w(async(req,res)=>{await q("update tickets set status='closed',updated_at=now() where id=$1",[req.t.id]);res.json({ok:true})}));
r.post('/:id/reopen',own,w(async(req,res)=>res.status(409).json({error:'ticket_closed'})));
module.exports=r;
