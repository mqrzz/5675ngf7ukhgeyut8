const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const PLANS=require('../plans');const T=require('../template');
const {send,status}=require('../send');
const ID=/^[0-9a-f-]{36}$/i,MAXH=400000,MAXT=100000;
r.use(need,sessionOnly);
const clip=(s,n)=>String(s==null?'':s).replace(/\u0000/g,'').slice(0,n);
const pub=t=>({id:t.id,name:t.name,subject:t.subject,html:t.html,text:t.text_body,variables:T.vars(t.subject,t.html,t.text_body),sent:t.sent||0,created_at:t.created_at,updated_at:t.updated_at});
const own=w(async(req,res,next)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [t]=await q('select * from templates where id=$1 and user_id=$2',[req.params.id,req.user.id]);
 if(!t)return res.status(404).json({error:'not_found'});req.t=t;next()});
r.get('/',w(async(req,res)=>{
 const rows=await q('select t.id,t.name,t.subject,t.html,t.text_body,t.created_at,t.updated_at,(select count(*)::int from emails e where e.template_id=t.id) sent from templates t where t.user_id=$1 order by t.updated_at desc limit 500',[req.user.id]);
 res.json(rows.map(x=>({...pub(x),html:undefined,text:undefined,thumb:x.html.length>30000?'':x.html})))}));
r.post('/',w(async(req,res)=>{
 const b=req.body||{},name=clip(b.name,80).trim();
 if(!name)return res.status(400).json({error:'invalid_name'});
 const html=clip(b.html,MAXH+1),text=clip(b.text,MAXT+1);
 if(html.length>MAXH||text.length>MAXT)return res.status(413).json({error:'template_too_large'});
 const [{plan}]=await q('select plan from users where id=$1',[req.user.id]);
 const [{n}]=await q('select count(*)::int n from templates where user_id=$1',[req.user.id]);
 if(n>=(PLANS[plan]||PLANS.free).templates)return res.status(403).json({error:'plan_limit'});
 const [t]=await q('insert into templates(user_id,name,subject,html,text_body) values($1,$2,$3,$4,$5) returning *',[req.user.id,name,clip(b.subject,300),html,text]);
 res.status(201).json(pub(t))}));
r.get('/:id',own,w(async(req,res)=>{const [{n}]=await q('select count(*)::int n from emails where template_id=$1',[req.t.id]);res.json(pub({...req.t,sent:n}))}));
r.patch('/:id',own,w(async(req,res)=>{
 let t;const b=req.body||{},cur=req.t;
 const name=b.name===undefined?cur.name:clip(b.name,80).trim();if(!name)return res.status(400).json({error:'invalid_name'});
 const html=b.html===undefined?cur.html:clip(b.html,MAXH+1),text=b.text===undefined?cur.text_body:clip(b.text,MAXT+1);
 if(html.length>MAXH||text.length>MAXT)return res.status(413).json({error:'template_too_large'});
 const subject=b.subject===undefined?cur.subject:clip(b.subject,300);
 if(name!==cur.name||subject!==cur.subject||html!==cur.html||text!==cur.text_body){
  await q('insert into template_versions(template_id,name,subject,html,text_body) values($1,$2,$3,$4,$5)',[cur.id,cur.name,cur.subject,cur.html,cur.text_body]);
  await q('delete from template_versions where template_id=$1 and id not in(select id from template_versions where template_id=$1 order by id desc limit 20)',[cur.id])}
 [t]=await q('update templates set name=$2,subject=$3,html=$4,text_body=$5,updated_at=now() where id=$1 returning *',[cur.id,name,subject,html,text]);
 res.json(pub(t))}));
r.get('/:id/versions',own,w(async(req,res)=>{
 const rows=await q('select id,name,subject,length(html) size,created_at from template_versions where template_id=$1 order by id desc limit 20',[req.t.id]);
 res.json(rows)}));
r.get('/:id/versions/:vid',own,w(async(req,res)=>{
 if(!/^\d+$/.test(req.params.vid))return res.status(404).json({error:'not_found'});
 const [v]=await q('select id,name,subject,html,text_body,created_at from template_versions where id=$1 and template_id=$2',[req.params.vid,req.t.id]);
 if(!v)return res.status(404).json({error:'not_found'});
 res.json({id:v.id,name:v.name,subject:v.subject,html:v.html,text:v.text_body,created_at:v.created_at})}));
r.post('/:id/duplicate',own,w(async(req,res)=>{
 const [{plan}]=await q('select plan from users where id=$1',[req.user.id]);
 const [{n}]=await q('select count(*)::int n from templates where user_id=$1',[req.user.id]);
 if(n>=(PLANS[plan]||PLANS.free).templates)return res.status(403).json({error:'plan_limit'});
 const [t]=await q('insert into templates(user_id,name,subject,html,text_body) values($1,$2,$3,$4,$5) returning *',[req.user.id,clip(req.t.name+' copy',80),req.t.subject,req.t.html,req.t.text_body]);
 res.status(201).json(pub(t))}));
r.delete('/:id',own,w(async(req,res)=>{await q('delete from templates where id=$1',[req.t.id]);res.json({ok:true})}));
r.post('/preview',w(async(req,res)=>{
 const b=req.body||{},v=T.clean(b.variables);
 res.json({subject:T.render(clip(b.subject,300),v,false),html:T.render(clip(b.html,MAXH),v,true),text:T.render(clip(b.text,MAXT),v,false),variables:T.vars(b.subject,b.html,b.text)})}));
r.post('/test',w(async(req,res)=>{
 const b=req.body||{},v=T.clean(b.variables);
 const [u]=await q('select email from users where id=$1',[req.user.id]);
 const from=clip(b.from,200).trim();
 if(!from)return res.status(400).json({error:'invalid_from'});
 try{
  const out=await send(req.user.id,{from,to:u.email,subject:'[Test] '+(T.render(clip(b.subject,300),v,false)||'(no subject)'),html:T.render(clip(b.html,MAXH),v,true)||undefined,text:T.render(clip(b.text,MAXT),v,false)||undefined},null);
  res.json({ok:true,to:u.email,id:out.id})
 }catch(e){if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}}));
module.exports=r;
