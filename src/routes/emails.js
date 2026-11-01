const r=require('express').Router();
const {q}=require('../db');const {w,need}=require('../auth');
const {send,check,status}=require('../send');
r.use(need);
const IDEM=/^[\x21-\x7e]{1,255}$/;
const fp=b=>require('crypto').createHash('sha256').update(JSON.stringify(b||{})).digest('hex');
r.post('/',w(async(req,res)=>{
 const key=req.get('Idempotency-Key');const print=fp(req.body);
 if(key!==undefined){
  if(!IDEM.test(key))return res.status(400).json({error:'invalid_idempotency_key'});
  await q("delete from idempotency_keys where created_at<now()-interval '24 hours'");
  const[ins]=await q('insert into idempotency_keys(user_id,key,fp) values($1,$2,$3) on conflict do nothing returning key',[req.user.id,key,print]);
  if(!ins){
   const[row]=await q('select fp,status,body from idempotency_keys where user_id=$1 and key=$2',[req.user.id,key]);
   if(!row)return res.status(409).json({error:'idempotency_in_progress'});
   if(row.fp!==print)return res.status(422).json({error:'idempotency_key_reused'});
   if(!row.body)return res.status(409).json({error:'idempotency_in_progress'});
   res.set('Idempotent-Replayed','true');return res.status(row.status).json(row.body)
  }
 }
 try{const out=await send(req.user.id,req.body||{},req.user.keyId);
  if(key)await q('update idempotency_keys set status=200,body=$3 where user_id=$1 and key=$2',[req.user.id,key,JSON.stringify(out)]);
  res.json(out)}
 catch(e){if(key)await q('delete from idempotency_keys where user_id=$1 and key=$2',[req.user.id,key]);
  if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}
}));
r.post('/check',w(async(req,res)=>{
 try{res.json(await check(req.user.id,req.body||{}))}
 catch(e){if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}
}));
r.get('/',w(async(req,res)=>{
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25));const args=[req.user.id];let where='user_id=$1';
 if(req.query.direction==='in'||req.query.direction==='out'){args.push(req.query.direction);where+=' and direction=$'+args.length}
 if(req.query.status){args.push(String(req.query.status));where+=' and status=$'+args.length}
 if(req.query.q){const x='%'+String(req.query.q).slice(0,100).replace(/[\\%_]/g,m=>'\\'+m)+'%';args.push(x);where+=' and (subject ilike $'+args.length+' or from_addr ilike $'+args.length+' or to_addrs::text ilike $'+args.length+')'}
 if(req.query.before){const t=new Date(req.query.before);if(!isNaN(t)){args.push(t.toISOString());where+=' and created_at<$'+args.length}}
 const rows=await q('select id,direction,from_addr,to_addrs,subject,status,created_at from emails where '+where+' order by created_at desc limit '+(lim+1),args);
 res.json({data:rows.slice(0,lim),next:rows.length>lim?rows[lim-1].created_at:null});
}));
r.get('/:id',w(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [e]=await q('select * from emails where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!e)return res.status(404).json({error:'not_found'});
 const ev=await q('select type,data,created_at from events where email_id=$1 order by created_at,id',[e.id]);
 res.json({id:e.id,direction:e.direction,from:e.from_addr,to:e.to_addrs,subject:e.subject,html:e.html,text:e.text_body,status:e.status,error:e.error,attachments:e.attachments||[],spam:e.spam_score==null?null:{score:+e.spam_score,rules:e.spam_rules||[]},in_reply_to:e.in_reply_to,created_at:e.created_at,events:ev});
}));
module.exports=r;
