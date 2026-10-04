const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const {notify}=require('../notify');const {transport,FROM}=require('../mailer');
const ID=/^[0-9a-f-]{36}$/i;
const SUBJ={en:'Geserd support replied to your ticket',ru:'Поддержка Geserd ответила на ваше обращение',fr:'Le support Geserd a répondu à votre demande',de:'Der Geserd-Support hat auf Ihre Anfrage geantwortet'};
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
r.use(need,sessionOnly,w(async(req,res,next)=>{const [u]=await q('select is_admin from users where id=$1',[req.user.id]);if(!u||!u.is_admin)return res.status(403).json({error:'forbidden'});next()}));
r.get('/tickets',w(async(req,res)=>{
 const st=['open','closed'].includes(req.query.status)?req.query.status:null;
 const rows=await q("select t.id,t.subject,t.topic,t.status,t.created_at,t.updated_at,u.email,(select author from ticket_messages m where m.ticket_id=t.id order by m.id desc limit 1) last_author from tickets t join users u on u.id=t.user_id "+(st?"where t.status=$1 ":"")+"order by t.updated_at desc limit 200",st?[st]:[]);
 res.json(rows)}));
r.get('/tickets/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [t]=await q('select t.id,t.subject,t.topic,t.status,t.created_at,u.email from tickets t join users u on u.id=t.user_id where t.id=$1',[req.params.id]);
 if(!t)return res.status(404).json({error:'not_found'});
 res.json({...t,messages:await q('select id,author,body,created_at from ticket_messages where ticket_id=$1 order by id',[t.id])})}));
r.post('/tickets/:id/reply',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const body=String((req.body||{}).message||'').trim().slice(0,5000);if(!body)return res.status(400).json({error:'invalid_message'});
 const [t]=await q('select t.id,t.subject,t.user_id,u.email,u.lang from tickets t join users u on u.id=t.user_id where t.id=$1',[req.params.id]);
 if(!t)return res.status(404).json({error:'not_found'});
 await q("insert into ticket_messages(ticket_id,author,body) values($1,'staff',$2)",[t.id,body]);
 await q("update tickets set updated_at=now(),status=$2 where id=$1",[t.id,req.body.close?'closed':'open']);
 await notify(t.user_id,'ticket','ticket_reply',t.subject,'/app/help/?t='+t.id);
 try{await transport.sendMail({from:{name:'Geserd',address:FROM},to:t.email,subject:SUBJ[t.lang]||SUBJ.en,text:body+'\n\n'+APP+'/app/help/?t='+t.id,headers:{'Auto-Submitted':'auto-generated'}})}catch(e){console.error('ticket mail',e.message)}
 res.json({ok:true})}));
r.get('/incidents',w(async(req,res)=>res.json(await q('select * from incidents order by started_at desc limit 100'))));
r.post('/incidents',w(async(req,res)=>{
 const b=req.body||{},title=String(b.title||'').trim().slice(0,160);if(!title)return res.status(400).json({error:'invalid_title'});
 const [i]=await q('insert into incidents(title,body,component,status,impact) values($1,$2,$3,$4,$5) returning *',[title,String(b.body||'').slice(0,2000)||null,String(b.component||'').slice(0,40)||null,['investigating','identified','monitoring'].includes(b.status)?b.status:'investigating',['minor','major','critical'].includes(b.impact)?b.impact:'minor']);
 res.status(201).json(i)}));
r.patch('/incidents/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const b=req.body||{},st=['investigating','identified','monitoring','resolved'].includes(b.status)?b.status:null;
 const [i]=await q("update incidents set status=coalesce($2,status),body=coalesce($3,body),resolved_at=case when $2='resolved' then now() else resolved_at end where id=$1 returning *",[req.params.id,st,b.body==null?null:String(b.body).slice(0,2000)]);
 i?res.json(i):res.status(404).json({error:'not_found'})}));
module.exports=r;
