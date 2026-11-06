const r=require('express').Router();
const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');
r.use(need,sessionOnly);
r.get('/',w(async(req,res)=>{
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||30));
 const rows=await q('select id,type,title,body,link,read_at,created_at from notifications where user_id=$1 order by created_at desc limit '+lim,[req.user.id]);
 const [{n}]=await q('select count(*)::int n from notifications where user_id=$1 and read_at is null',[req.user.id]);
 res.json({unread:n,data:rows})}));
r.get('/unread',w(async(req,res)=>{const [{n}]=await q('select count(*)::int n from notifications where user_id=$1 and read_at is null',[req.user.id]);res.json({unread:n})}));
r.delete('/',w(async(req,res)=>{const r2=await q('delete from notifications where user_id=$1 and read_at is not null returning id',[req.user.id]);res.json({deleted:r2.length})}));
r.post('/read',w(async(req,res)=>{await q('update notifications set read_at=now() where user_id=$1 and read_at is null',[req.user.id]);res.json({ok:true})}));
r.post('/:id/read',w(async(req,res)=>{if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'invalid_id'});await q('update notifications set read_at=now() where id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
r.delete('/:id',w(async(req,res)=>{if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'invalid_id'});await q('delete from notifications where id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
module.exports=r;
