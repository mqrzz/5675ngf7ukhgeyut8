const express=require('express');const QR=require('qrcode');const {q}=require('../db');const {w,need,sessionOnly,allowMfa,sha}=require('../auth');const {enc,dec}=require('../secret');const TOTP=require('../totp');
const r=express.Router();
const hits=new Map();
function limited(key){const n=Date.now(),h=(hits.get(key)||[]).filter(t=>n-t<60000);if(h.length>=6){hits.set(key,h);return true}h.push(n);hits.set(key,h);return false}
async function verifyAny(userId,code,consume){
 const[row]=await q('select secret_enc,recovery,last_step,enabled from user_totp where user_id=$1',[userId]);
 if(!row||!row.enabled)return{ok:false,error:'not_enabled'};
 const plain=String(code||'').trim();
 if(/^\d{3}\s?\d{3}$/.test(plain)){
  const s=TOTP.check(dec(row.secret_enc),plain,row.last_step);
  if(s==null)return{ok:false,error:'invalid_code'};
  const upd=await q('update user_totp set last_step=$2 where user_id=$1 and (last_step is null or last_step<$2) returning 1',[userId,s]);
  if(!upd.length)return{ok:false,error:'invalid_code'};
  return{ok:true,kind:'app'};
 }
 const h=TOTP.hashRec(plain);
 if(TOTP.norm(plain).length===10&&row.recovery.includes(h)){
  if(consume!==false){const upd=await q('update user_totp set recovery=array_remove(recovery,$2) where user_id=$1 and $2=any(recovery) returning 1',[userId,h]);if(!upd.length)return{ok:false,error:'invalid_code'}}
  return{ok:true,kind:'recovery'};
 }
 return{ok:false,error:'invalid_code'};
}
const guard=[need,sessionOnly];
r.get('/',...guard,w(async(req,res)=>{
 const[row]=await q('select enabled,enabled_at,coalesce(array_length(recovery,1),0) left from user_totp where user_id=$1',[req.user.id]);
 res.set('Cache-Control','no-store');res.json({enabled:!!(row&&row.enabled),enabled_at:row&&row.enabled?row.enabled_at:null,recovery_left:row&&row.enabled?row.left:0})}));
r.post('/setup',...guard,w(async(req,res)=>{
 const[ex]=await q('select enabled from user_totp where user_id=$1',[req.user.id]);
 if(ex&&ex.enabled)return res.status(409).json({error:'already_enabled'});
 const[u]=await q('select email from users where id=$1',[req.user.id]);
 const sec=TOTP.secret();
 await q('insert into user_totp(user_id,secret_enc,enabled) values($1,$2,false) on conflict(user_id) do update set secret_enc=$2,enabled=false,recovery=\'{}\',last_step=null,created_at=now()',[req.user.id,enc(sec)]);
 const uri=TOTP.url(sec,u.email);
 const svg=await QR.toString(uri,{type:'svg',margin:1,errorCorrectionLevel:'M'});
 res.set('Cache-Control','no-store');res.json({secret:sec.replace(/(.{4})/g,'$1 ').trim(),uri,qr:svg})}));
r.post('/enable',...guard,w(async(req,res)=>{
 if(limited('en:'+req.user.id))return res.status(429).json({error:'rate_limited'});
 const[row]=await q('select secret_enc,enabled,last_step from user_totp where user_id=$1',[req.user.id]);
 if(!row)return res.status(409).json({error:'setup_required'});
 if(row.enabled)return res.status(409).json({error:'already_enabled'});
 const s=TOTP.check(dec(row.secret_enc),(req.body||{}).code,null);
 if(s==null)return res.status(400).json({error:'invalid_code'});
 const codes=TOTP.recoveryCodes(8);
 await q('update user_totp set enabled=true,enabled_at=now(),last_step=$2,recovery=$3 where user_id=$1',[req.user.id,s,codes.map(TOTP.hashRec)]);
 res.json({ok:true,recovery:codes})}));
r.post('/recovery',...guard,w(async(req,res)=>{
 if(limited('rc:'+req.user.id))return res.status(429).json({error:'rate_limited'});
 const v=await verifyAny(req.user.id,(req.body||{}).code,false);
 if(!v.ok||v.kind!=='app')return res.status(400).json({error:'invalid_code'});
 const codes=TOTP.recoveryCodes(8);
 await q('update user_totp set recovery=$2 where user_id=$1',[req.user.id,codes.map(TOTP.hashRec)]);
 res.json({ok:true,recovery:codes})}));
r.post('/disable',...guard,w(async(req,res)=>{
 if(limited('di:'+req.user.id))return res.status(429).json({error:'rate_limited'});
 const v=await verifyAny(req.user.id,(req.body||{}).code);
 if(!v.ok)return res.status(400).json({error:v.error==='not_enabled'?'not_enabled':'invalid_code'});
 await q('delete from user_totp where user_id=$1',[req.user.id]);
 res.json({ok:true})}));
const login=express.Router();
login.post('/',allowMfa,need,w(async(req,res)=>{
 if(req.user.via!=='session')return res.status(403).json({error:'session_required'});
 if(!req.user.mfaPending)return res.json({ok:true});
 if(limited('lg:'+req.user.id))return res.status(429).json({error:'rate_limited'});
 const v=await verifyAny(req.user.id,(req.body||{}).code);
 if(!v.ok)return res.status(400).json({error:'invalid_code'});
 await q('update sessions set mfa_ok=true where token_hash=$1',[req.user.sid]);
 const[left]=await q('select coalesce(array_length(recovery,1),0) n from user_totp where user_id=$1',[req.user.id]);
 res.json({ok:true,kind:v.kind,recovery_left:left?left.n:0})}));
module.exports={account:r,login,verifyAny};
