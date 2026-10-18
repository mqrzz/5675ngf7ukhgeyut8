const r=require('express').Router();
const c=require('crypto');
const {q}=require('../db');
const {w,startSession}=require('../auth');
const {dec}=require('../secret');
const S=require('../sso');
function baseUrl(){return process.env.APP_URL||'https://geserd.com'}
function sign(o){const p=Buffer.from(JSON.stringify(o)).toString('base64url');return p+'.'+c.createHmac('sha256',process.env.SECRET_KEY||'').update(p).digest('base64url')}
function unsign(s){const[p,h]=String(s||'').split('.');if(!p||!h)return null;const h2=c.createHmac('sha256',process.env.SECRET_KEY||'').update(p).digest('base64url');if(h2.length!==h.length||!c.timingSafeEqual(Buffer.from(h2),Buffer.from(h)))return null;try{const o=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));return Date.now()-o.t>600000?null:o}catch{return null}}
async function conn(domain){const [x]=await q('select * from sso_connections where domain=$1 and enabled',[domain]);return x}
r.get('/lookup',w(async(req,res)=>{
 const d=S.domainOf(req.query.email);res.set('Cache-Control','no-store');
 res.json({sso:!!(d&&await conn(d))})}));
r.get('/start',w(async(req,res)=>{
 const d=S.domainOf(req.query.email);const x=d&&await conn(d);
 if(!x)return res.status(404).json({error:'sso_not_configured'});
 let meta;try{meta=await S.discover(x.issuer)}catch(e){return res.status(502).json({error:e.message})}
 const {verifier,challenge}=S.pkce(),nonce=c.randomBytes(16).toString('hex'),state=c.randomBytes(16).toString('hex');
 res.cookie('gs_sso',sign({t:Date.now(),d,v:verifier,n:nonce,s:state}),{httpOnly:true,secure:!process.env.SSO_ALLOW_HTTP,sameSite:'lax',path:'/api/auth/sso',maxAge:600000});
 const u=new URL(meta.authorization_endpoint);
 u.searchParams.set('client_id',x.client_id);u.searchParams.set('redirect_uri',baseUrl()+'/api/auth/sso/callback');
 u.searchParams.set('response_type','code');u.searchParams.set('scope','openid email profile');
 u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);
 u.searchParams.set('code_challenge',challenge);u.searchParams.set('code_challenge_method','S256');
 u.searchParams.set('login_hint',String(req.query.email).trim().toLowerCase());
 res.redirect(u.toString())}));
r.get('/callback',w(async(req,res)=>{
 const m=/(?:^|; )gs_sso=([^;]+)/.exec(req.headers.cookie||'');
 const st=m&&unsign(decodeURIComponent(m[1]));
 res.clearCookie('gs_sso',{path:'/api/auth/sso'});
 if(!st||st.s!==String(req.query.state||''))return res.status(400).json({error:'bad_state'});
 const x=await conn(st.d);if(!x)return res.status(404).json({error:'sso_not_configured'});
 if(req.query.error)return res.redirect('/login/?sso=denied');
 let meta,tok;
 try{
  meta=await S.discover(x.issuer);
  const tr=await fetch(meta.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},signal:AbortSignal.timeout(8000),
   body:new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code||''),redirect_uri:baseUrl()+'/api/auth/sso/callback',client_id:x.client_id,client_secret:dec(x.client_secret_enc),code_verifier:st.v})});
  tok=await tr.json();
  if(!tok.id_token)throw new Error('token_failed');
  const jwks=await(await fetch(meta.jwks_uri,{signal:AbortSignal.timeout(8000)})).json();
  var claims=S.verifyIdToken(tok.id_token,jwks,{issuer:x.issuer,clientId:x.client_id,nonce:st.n})
 }catch(e){console.error('sso',e.message);return res.status(502).json({error:'sso_failed'})}
 const email=String(claims.email||'').trim().toLowerCase();
 if(!email||claims.email_verified===false||S.domainOf(email)!==st.d)return res.status(403).json({error:'email_not_allowed'});
 let [acc]=await q('select user_id from oauth_accounts where provider=$1 and provider_uid=$2',['sso:'+st.d,claims.sub]);
 let userId=acc&&acc.user_id;
 if(!userId){
  let [u]=await q('select id from users where email=$1',[email]);
  if(!u){[u]=await q('insert into users(email,name) values($1,$2) returning id',[email,claims.name||null]);await require('../siberia').attach(u.id,email).catch(()=>{})}
  userId=u.id;
  await q('insert into oauth_accounts(provider,provider_uid,user_id) values($1,$2,$3) on conflict do nothing',['sso:'+st.d,claims.sub,userId])}
 await startSession(res,userId,req.ip,req.headers['user-agent']);
 require('../multiacct').check(userId,req).catch(e=>console.error('multiacct',e.message));
 res.redirect('/app/')}));
module.exports=r;
