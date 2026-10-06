const r=require('express').Router();const c=require('crypto');
const {q}=require('../db');const {w,need,sessionOnly,sha}=require('../auth');
const LANGS=['en','ru','fr','de'],KEYS=['bounce','complaint','quota','domain','ticket'];
r.use(need,sessionOnly);
const cur=req=>{const m=/(?:^|; )gs_sid=([^;]+)/.exec(req.headers.cookie||'');return m?sha(m[1]):null};
r.patch('/preferences',w(async(req,res)=>{
 const b=req.body||{};
 if(b.lang!==undefined){if(!LANGS.includes(b.lang))return res.status(400).json({error:'invalid_lang'});await q('update users set lang=$2 where id=$1',[req.user.id,b.lang])}
 if(b.notify&&typeof b.notify==='object'){
  const [u]=await q('select notify from users where id=$1',[req.user.id]);const n={...(u.notify||{})};
  for(const k of KEYS)if(typeof b.notify[k]==='boolean')n[k]=b.notify[k];
  await q('update users set notify=$2 where id=$1',[req.user.id,JSON.stringify(n)])}
 const [u]=await q('select lang,notify from users where id=$1',[req.user.id]);res.json(u)}));
r.get('/sessions',w(async(req,res)=>{
 const me=cur(req);
 const rows=await q('select token_hash,ip,ua,created_at,expires_at from sessions where user_id=$1 and expires_at>now() order by created_at desc limit 50',[req.user.id]);
 res.json(rows.map(s=>({id:s.token_hash.slice(0,16),current:s.token_hash===me,ip:s.ip,ua:s.ua,created_at:s.created_at,expires_at:s.expires_at})))}));
r.delete('/sessions/:id',w(async(req,res)=>{
 const me=cur(req),id=String(req.params.id||'');if(!/^[0-9a-f]{16}$/.test(id))return res.status(400).json({error:'invalid_id'});
 const rows=await q('select token_hash from sessions where user_id=$1 and left(token_hash,16)=$2',[req.user.id,id]);
 for(const s of rows)if(s.token_hash!==me)await q('delete from sessions where token_hash=$1',[s.token_hash]);
 res.json({ok:true})}));
r.post('/sessions/revoke-others',w(async(req,res)=>{await q('delete from sessions where user_id=$1 and token_hash<>$2',[req.user.id,cur(req)||'']);res.json({ok:true})}));
r.post('/delete',w(async(req,res)=>{
 const [u]=await q('select email from users where id=$1',[req.user.id]);
 if(String((req.body||{}).email||'').trim().toLowerCase()!==u.email.toLowerCase())return res.status(400).json({error:'email_mismatch'});
 await q('delete from users where id=$1',[req.user.id]);
 res.clearCookie('gs_sid',{path:'/'});res.json({ok:true})}));
r.get('/identities',w(async(req,res)=>{
 const [u]=await q('select email,created_at from users where id=$1',[req.user.id]);
 const rows=await q('select provider from oauth_accounts where user_id=$1 order by provider',[req.user.id]);
 res.json({email:u.email,created_at:u.created_at,providers:rows.map(x=>x.provider)})}));
r.get('/export',w(async(req,res)=>{
 const id=req.user.id;
 const [user]=await q('select id,email,name,plan,lang,notify,send_settings,created_at from users where id=$1',[id]);
 const out={exported_at:new Date().toISOString(),user,
  domains:await q('select name,status,sending_ok,receiving_ok,created_at from domains where user_id=$1 order by created_at',[id]),
  api_keys:await q('select name,prefix,created_at,last_used_at,revoked_at from api_keys where user_id=$1 order by created_at',[id]),
  webhooks:await q('select url,events,active,created_at from webhooks where user_id=$1 order by created_at',[id]),
  templates:await q('select name,subject,html,text_body,created_at,updated_at from templates where user_id=$1 order by created_at',[id]),
  suppressions:await q('select address,reason,created_at from suppressions where user_id=$1 order by created_at',[id]),
  tickets:await q('select t.subject,t.topic,t.status,t.created_at,(select json_agg(json_build_object(\'author\',m.author,\'body\',m.body,\'at\',m.created_at) order by m.id) from ticket_messages m where m.ticket_id=t.id) messages from tickets t where t.user_id=$1 order by t.created_at',[id])};
 res.set('Content-Type','application/json; charset=utf-8');
 res.set('Content-Disposition','attachment; filename="geserd-export.json"');
 res.send(JSON.stringify(out,null,1))}));
module.exports=r;
