const r=require('express').Router();
const {q}=require('../db');const {w,need}=require('../auth');
const A=require('../automation');
r.use(need);
const id=v=>/^[0-9a-f-]{36}$/i.test(String(v));
const pub=a=>({id:a.id,name:a.name,enabled:a.enabled,trigger_event:a.trigger_event,steps:a.steps,updated_at:a.updated_at});
r.get('/',w(async(req,res)=>{const rows=await q('select a.*,(select count(*) from automation_runs x where x.automation_id=a.id)::int runs from automations a where user_id=$1 order by updated_at desc',[req.user.id]);res.json({data:rows.map(a=>({...pub(a),runs:a.runs}))})}));
r.post('/',w(async(req,res)=>{
 const n=await q('select count(*)::int c from automations where user_id=$1',[req.user.id]);if(n[0].c>=25)return res.status(422).json({error:'limit'});
 const b=req.body||{};const [a]=await q('insert into automations(user_id,name,trigger_event,steps) values($1,$2,$3,$4) returning *',[req.user.id,String(b.name||'Untitled automation').slice(0,120),String(b.trigger_event||'').slice(0,80),JSON.stringify(A.cleanSteps(b.steps))]);res.json(pub(a))}));
r.get('/:id',w(async(req,res)=>{if(!id(req.params.id))return res.status(404).json({error:'not_found'});const [a]=await q('select * from automations where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!a)return res.status(404).json({error:'not_found'});const runs=await q('select email,status,step_idx,error,created_at,finished_at from automation_runs where automation_id=$1 order by created_at desc limit 30',[a.id]);res.json({...pub(a),runs})}));
r.put('/:id',w(async(req,res)=>{
 if(!id(req.params.id))return res.status(404).json({error:'not_found'});const b=req.body||{};
 const [a]=await q('update automations set name=coalesce($3,name),trigger_event=coalesce($4,trigger_event),steps=coalesce($5,steps),enabled=coalesce($6,enabled),updated_at=now() where id=$1 and user_id=$2 returning *',[req.params.id,req.user.id,b.name==null?null:String(b.name).slice(0,120),b.trigger_event==null?null:String(b.trigger_event).slice(0,80),b.steps==null?null:JSON.stringify(A.cleanSteps(b.steps)),typeof b.enabled==='boolean'?b.enabled:null]);
 if(!a)return res.status(404).json({error:'not_found'});res.json(pub(a))}));
r.delete('/:id',w(async(req,res)=>{if(!id(req.params.id))return res.status(404).json({error:'not_found'});await q('delete from automations where id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
module.exports=r;
