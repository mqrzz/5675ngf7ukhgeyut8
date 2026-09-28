const r=require('express').Router();
const c=require('crypto');
const nodemailer=require('nodemailer');
const {q}=require('../db');
const {sha,w,startSession}=require('../auth');

// --- local mail via the server's own Postfix (same MTA planned for sending) ---
const mailer=nodemailer.createTransport({sendmail:true,newline:'unix',path:'/usr/sbin/sendmail'});
const FROM=process.env.FROM_EMAIL||('noreply@'+(process.env.MAIL_HOST||'localhost'));
function sendCodeMail(to,code){
 return mailer.sendMail({from:FROM,to:to,subject:'Your Geserd sign-in code',
  text:'Your code is '+code+'. It expires in 10 minutes. If you did not request this, ignore this email.',
  html:'<p>Your code is <b style="font-size:20px;letter-spacing:2px">'+code+'</b>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>'});
}

// --- region gate: Cloudflare sets CF-IPCountry; unknown => fail open (allow) with a TODO for a real geoip fallback ---
function countryOf(req){const cc=req.headers['cf-ipcountry'];return cc&&cc!=='XX'?String(cc).toUpperCase():null}
function allowedProviders(country){
 if(country==='RU')return['yandex'];
 return['github','google'];
}

// --- request-code: simple in-memory throttle, 1 per email+ip per 60s ---
const EMAIL_RX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const throttle=new Map();
setInterval(()=>{const now=Date.now();for(const[k,t]of throttle)if(now-t>60000)throttle.delete(k)},300000).unref();

r.post('/request-code',w(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();
 if(!EMAIL_RX.test(email)||email.length>254)return res.status(400).json({error:'invalid_email'});
 const key=email+'|'+req.ip;
 if(throttle.has(key)&&Date.now()-throttle.get(key)<60000)return res.status(429).json({error:'rate_limited'});
 throttle.set(key,Date.now());
 const code=String(c.randomInt(0,1000000)).padStart(6,'0');
 await q('insert into login_codes(email,code_hash,attempts,expires_at) values($1,$2,0,now()+interval \'10 minutes\') on conflict(email) do update set code_hash=$2,attempts=0,expires_at=now()+interval \'10 minutes\'',[email,sha(code)]);
 try{await sendCodeMail(email,code)}catch(e){console.error('mail send failed',e);return res.status(502).json({error:'mail_failed'})}
 res.json({ok:true})
}));

r.post('/verify-code',w(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();
 const code=String(req.body.code||'').trim();
 const [row]=await q('select * from login_codes where email=$1 and expires_at>now()',[email]);
 if(!row)return res.status(400).json({error:'expired_or_missing'});
 if(row.attempts>=5)return res.status(429).json({error:'too_many_attempts'});
 if(row.code_hash!==sha(code)){await q('update login_codes set attempts=attempts+1 where email=$1',[email]);return res.status(400).json({error:'wrong_code'})}
 await q('delete from login_codes where email=$1',[email]);
 let [u]=await q('select id from users where email=$1',[email]);
 if(!u)[u]=await q('insert into users(email,country) values($1,$2) returning id',[email,countryOf(req)]);
 await startSession(res,u.id,req.ip);
 res.json({ok:true})
}));

// --- OAuth: GitHub / Google / Yandex, region-gated server-side ---
const PROVIDERS={
 github:{
  authorize:'https://github.com/login/oauth/authorize',scope:'read:user user:email',
  token:'https://github.com/login/oauth/access_token',
  profile:async tok=>{
   const p=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+tok,'User-Agent':'geserd'}}).then(x=>x.json());
   let email=p.email;
   if(!email){const es=await fetch('https://api.github.com/user/emails',{headers:{Authorization:'Bearer '+tok,'User-Agent':'geserd'}}).then(x=>x.json());email=(es.find(e=>e.primary)||es[0]||{}).email}
   return{uid:String(p.id),email:email,name:p.name||p.login}
  }
 },
 google:{
  authorize:'https://accounts.google.com/o/oauth2/v2/auth',scope:'openid email profile',
  token:'https://oauth2.googleapis.com/token',
  profile:async tok=>{const p=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+tok}}).then(x=>x.json());return{uid:p.sub,email:p.email,name:p.name}}
 },
 yandex:{
  authorize:'https://oauth.yandex.ru/authorize',scope:'login:email login:info',
  token:'https://oauth.yandex.ru/token',
  profile:async tok=>{const p=await fetch('https://login.yandex.ru/info?format=json',{headers:{Authorization:'OAuth '+tok}}).then(x=>x.json());return{uid:String(p.id),email:p.default_email||(p.emails&&p.emails[0]),name:p.real_name||p.display_name}}
 }
};

function baseUrl(){return process.env.APP_URL||'https://geserd.com'}
function signState(obj){const p=Buffer.from(JSON.stringify(obj)).toString('base64url');const h=c.createHmac('sha256',process.env.SECRET_KEY||'').update(p).digest('base64url');return p+'.'+h}
function verifyState(s){const[p,h]=String(s||'').split('.');if(!p||!h)return null;const h2=c.createHmac('sha256',process.env.SECRET_KEY||'').update(p).digest('base64url');if(h2!==h)return null;try{const o=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(Date.now()-o.t>600000)return null;return o}catch{return null}}

r.get('/oauth/:provider',(req,res)=>{
 const name=req.params.provider,pr=PROVIDERS[name];
 if(!pr)return res.status(404).json({error:'unknown_provider'});
 const country=countryOf(req);
 if(!allowedProviders(country).includes(name))return res.status(403).json({error:'not_available_in_region'});
 const clientId=process.env[name.toUpperCase()+'_CLIENT_ID'];
 if(!clientId)return res.status(503).json({error:'provider_not_configured'});
 const redirect=baseUrl()+'/api/auth/oauth/'+name+'/callback';
 const state=signState({t:Date.now(),n:c.randomBytes(8).toString('hex')});
 const u=new URL(pr.authorize);
 u.searchParams.set('client_id',clientId);
 u.searchParams.set('redirect_uri',redirect);
 u.searchParams.set('scope',pr.scope);
 u.searchParams.set('response_type','code');
 u.searchParams.set('state',state);
 res.redirect(u.toString())
});

r.get('/oauth/:provider/callback',w(async(req,res)=>{
 const name=req.params.provider,pr=PROVIDERS[name];
 if(!pr)return res.status(404).json({error:'unknown_provider'});
 if(!verifyState(req.query.state))return res.status(400).json({error:'bad_state'});
 const country=countryOf(req);
 if(!allowedProviders(country).includes(name))return res.status(403).json({error:'not_available_in_region'});
 const clientId=process.env[name.toUpperCase()+'_CLIENT_ID'],clientSecret=process.env[name.toUpperCase()+'_CLIENT_SECRET'];
 if(!clientId||!clientSecret)return res.status(503).json({error:'provider_not_configured'});
 const redirect=baseUrl()+'/api/auth/oauth/'+name+'/callback';
 const tokRes=await fetch(pr.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
  body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code:String(req.query.code||''),redirect_uri:redirect,grant_type:'authorization_code'})});
 const tokJson=await tokRes.json();
 if(!tokJson.access_token)return res.status(502).json({error:'oauth_token_failed'});
 const prof=await pr.profile(tokJson.access_token);
 if(!prof.email)return res.status(400).json({error:'no_email_from_provider'});
 let [acc]=await q('select user_id from oauth_accounts where provider=$1 and provider_uid=$2',[name,prof.uid]);
 let userId;
 if(acc){userId=acc.user_id}
 else{
  let [u]=await q('select id from users where email=$1',[prof.email]);
  if(!u)[u]=await q('insert into users(email,name,country) values($1,$2,$3) returning id',[prof.email,prof.name||null,country]);
  userId=u.id;
  await q('insert into oauth_accounts(provider,provider_uid,user_id) values($1,$2,$3) on conflict do nothing',[name,prof.uid,userId]);
 }
 await startSession(res,userId,req.ip);
 res.redirect('/app/')
}));

module.exports=r;
