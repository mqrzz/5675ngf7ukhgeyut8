const c=require('crypto');const {q}=require('./db');const SET=require('./settings');
const sha=s=>c.createHash('sha256').update(s).digest('hex');
const w=f=>(a,b,n)=>Promise.resolve(f(a,b,n)).catch(n);
async function who(req){const h=req.headers.authorization||'';
 if(h.startsWith('Bearer gs_')){const r=await q('update api_keys k set last_used_at=now() from users u where k.key_hash=$1 and k.revoked_at is null and u.id=k.user_id returning k.id,k.user_id,u.status,k.permission,k.domain_id',[sha(h.slice(7))]);if(!r[0])return null;if(!SET.ipAllowed(await SET.get(r[0].user_id),req.ip))return{blocked:true};return{id:r[0].user_id,via:'key',keyId:r[0].id,status:r[0].status,perm:r[0].permission,keyDomain:r[0].domain_id}}
 const m=/(?:^|; )gs_sid=([^;]+)/.exec(req.headers.cookie||'');
 if(m){const r=await q('select s.user_id,s.mfa_ok,u.status from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now()',[sha(m[1])]);return r[0]&&{id:r[0].user_id,via:'session',status:r[0].status,mfaPending:!r[0].mfa_ok,sid:sha(m[1])}}}
const need=w(async(req,res,next)=>{const u=await who(req);if(!u)return res.status(401).json({error:'unauthorized'});if(u.blocked)return res.status(403).json({error:'ip_not_allowed'});if(u.status==='blocked'&&!req.allowBlocked)return res.status(403).json({error:'account_blocked'});if(u.mfaPending&&!req.allowMfa)return res.status(401).json({error:'mfa_required'});req.user=u;if(u.via==='key'&&u.perm==='sending'&&!(req.method==='POST'&&/^\/api\/(emails\/?|emails\/check\/?|auth-kit\/send\/?)$/.test(req.baseUrl+req.path)))return res.status(403).json({error:'key_restricted'});if(u.via==='key')require('./apilog').attach(req,res);next()});
const allowMfa=(req,res,next)=>{req.allowMfa=true;next()};
const allowBlocked=(req,res,next)=>{req.allowBlocked=true;next()};
const sessionOnly=(req,res,next)=>req.user.via==='session'?next():res.status(403).json({error:'session_required'});
const SESSION_DAYS=30;
async function startSession(res,userId,ip,ua){
 const token=c.randomBytes(32).toString('base64url');
 const[t]=await q('select 1 from user_totp where user_id=$1 and enabled',[userId]);
 await q('insert into sessions(token_hash,user_id,ip,ua,expires_at,mfa_ok) values($1,$2,$3,$4,now()+interval \''+SESSION_DAYS+' days\',$5)',[sha(token),userId,ip||null,ua?String(ua).slice(0,300):null,!t]);
 res.cookie('gs_sid',token,{httpOnly:true,secure:true,sameSite:'lax',maxAge:SESSION_DAYS*86400000,path:'/'});
}
module.exports={sha,w,need,sessionOnly,allowBlocked,allowMfa,startSession};
