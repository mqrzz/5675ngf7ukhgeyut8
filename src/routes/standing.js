const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly,allowBlocked}=require('../auth');
r.use(allowBlocked,need,sessionOnly);
r.get('/',w(async(req,res)=>{
 const [u]=await q('select status from users where id=$1',[req.user.id]);
 const [ap]=await q("select id,status,created_at from tickets where user_id=$1 and topic='appeal' order by created_at desc limit 1",[req.user.id]);
 res.set('Cache-Control','no-store');
 res.json({status:u.status,appeal:ap||null})}));
r.post('/appeal',w(async(req,res)=>{
 const [u]=await q('select status from users where id=$1',[req.user.id]);
 if(u.status!=='blocked'&&u.status!=='frozen')return res.status(400).json({error:'not_restricted'});
 const body=String((req.body||{}).message==null?'':(req.body||{}).message).replace(/\u0000/g,'').trim().slice(0,5000);
 if(body.length<5)return res.status(400).json({error:'invalid_message'});
 const [open]=await q("select id from tickets where user_id=$1 and topic='appeal' and status<>'closed' limit 1",[req.user.id]);
 if(open){await q("insert into ticket_messages(ticket_id,author,body) values($1,'user',$2)",[open.id,body]);await q('update tickets set updated_at=now() where id=$1',[open.id]);return res.status(201).json({id:open.id})}
 const [t]=await q("insert into tickets(user_id,subject,topic) values($1,$2,'appeal') returning id",[req.user.id,'Account '+u.status+': appeal']);
 await q("insert into ticket_messages(ticket_id,author,body) values($1,'user',$2)",[t.id,body]);
 res.status(201).json({id:t.id})}));
r.get('/export',w(async(req,res)=>{
 const out=await require('../exportdata').build(req.user.id);
 res.set('Content-Type','application/json; charset=utf-8');
 res.set('Content-Disposition','attachment; filename="geserd-export.json"');
 res.send(JSON.stringify(out,null,1))}));
module.exports=r;
