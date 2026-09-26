// Auth: session cookie (ov_sid) or Bearer API key (ov_...). Sets req.user={id,via}.
const c=require('crypto');const {q}=require('./db');
const sha=s=>c.createHash('sha256').update(s).digest('hex');
const w=f=>(a,b,n)=>Promise.resolve(f(a,b,n)).catch(n);
async function who(req){const h=req.headers.authorization||'';
 if(h.startsWith('Bearer ov_')){const r=await q('update api_keys set last_used_at=now() where key_hash=$1 and revoked_at is null returning user_id',[sha(h.slice(7))]);return r[0]&&{id:r[0].user_id,via:'key'}}
 const m=/(?:^|; )ov_sid=([^;]+)/.exec(req.headers.cookie||'');
 if(m){const r=await q('select user_id from sessions where token_hash=$1 and expires_at>now()',[sha(m[1])]);return r[0]&&{id:r[0].user_id,via:'session'}}}
const need=w(async(req,res,next)=>{const u=await who(req);if(!u)return res.status(401).json({error:'unauthorized'});req.user=u;next()});
const sessionOnly=(req,res,next)=>req.user.via==='session'?next():res.status(403).json({error:'session_required'});
module.exports={sha,w,need,sessionOnly};
