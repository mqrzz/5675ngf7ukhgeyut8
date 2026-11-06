process.env.SSO_ALLOW_HTTP='1';process.env.SECRET_KEY='ab'.repeat(32);process.env.APP_URL='http://127.0.0.1:4101';
const c=require('crypto'),http=require('http'),Module=require('module'),path=require('path');
const sec=require('../src/secret');
const users=[],oauth=[],sessions=[];
const conn={domain:'corp.com',issuer:'',client_id:'cid',client_secret_enc:sec.enc('shh'),enabled:true};
const fake={
 '../db':{q:async(sql,p)=>{
  if(/from sso_connections/.test(sql))return p[0]===conn.domain&&conn.enabled?[conn]:[];
  if(/from oauth_accounts/.test(sql)){const o=oauth.find(x=>x.p===p[0]&&x.u===p[1]);return o?[{user_id:o.id}]:[]}
  if(/insert into oauth_accounts/.test(sql)){oauth.push({p:p[0],u:p[1],id:p[2]});return[]}
  if(/select id from users/.test(sql)){const u=users.find(x=>x.email===p[0]);return u?[u]:[]}
  if(/insert into users/.test(sql)){const u={id:'user'+(users.length+1),email:p[0],name:p[1]};users.push(u);return[u]}
  return[]}},
 '../auth':{w:f=>(rq,rs,n)=>Promise.resolve(f(rq,rs,n)).catch(n),startSession:async(res,id)=>{sessions.push(id);res.cookie('gs_sid','tok'+id)}},
 '../siberia':{attach:async()=>{}},'../multiacct':{check:async()=>{}}};
const ol=Module._load;
Module._load=function(req,parent,...a){if(parent&&/routes[\\/]sso\.js$/.test(parent.filename)&&fake[req])return fake[req];return ol.call(this,req,parent,...a)};
const express=require('express');
const {publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'k1',use:'sig'};
const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
let lastNonce,emailClaim='ann@corp.com',verified=true;
const idp=http.createServer((q,s)=>{
 const base='http://127.0.0.1:4102';s.setHeader('Content-Type','application/json');
 if(q.url.startsWith('/.well-known'))return s.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/auth',token_endpoint:base+'/token',jwks_uri:base+'/jwks'}));
 if(q.url==='/jwks')return s.end(JSON.stringify({keys:[jwk]}));
 if(q.url==='/token'){let d='';q.on('data',x=>d+=x);q.on('end',()=>{const f=new URLSearchParams(d);
  if(f.get('client_secret')!=='shh'||!f.get('code_verifier')||f.get('code')!=='thecode')return s.end(JSON.stringify({error:'bad'}));
  const u=b({alg:'RS256',kid:'k1'})+'.'+b({iss:base,aud:'cid',exp:Math.floor(Date.now()/1000)+300,nonce:lastNonce,sub:'sub-1',email:emailClaim,email_verified:verified,name:'Ann'});
  s.end(JSON.stringify({id_token:u+'.'+c.sign('RSA-SHA256',Buffer.from(u),privateKey).toString('base64url')}))});return}
 s.statusCode=404;s.end('{}')}).listen(4102);
conn.issuer='http://127.0.0.1:4102';
const app=express();app.use('/api/auth/sso',require('../src/routes/sso'));
const web=app.listen(4101,async()=>{
 const get=(u,h={})=>fetch('http://127.0.0.1:4101'+u,{redirect:'manual',headers:h});
 let ok=true;const chk=(n,v)=>{console.log(v?'ok   ':'FAIL ',n);if(!v)ok=false};
 chk('lookup corp.com is sso',(await(await get('/api/auth/sso/lookup?email=a@corp.com')).json()).sso===true);
 chk('lookup other domain is not sso',(await(await get('/api/auth/sso/lookup?email=a@other.com')).json()).sso===false);
 chk('start for other domain is 404',(await get('/api/auth/sso/start?email=a@other.com')).status===404);
 const run=async()=>{const st=await get('/api/auth/sso/start?email='+emailClaim);const loc=new URL(st.headers.get('location'));lastNonce=loc.searchParams.get('nonce');
  chk('start redirects with PKCE S256',loc.searchParams.get('code_challenge_method')==='S256'&&!!loc.searchParams.get('code_challenge'));
  const ck=st.headers.get('set-cookie').split(';')[0];return{ck,state:loc.searchParams.get('state')}};
 let r=await run();
 chk('callback with wrong state is 400',(await get('/api/auth/sso/callback?code=thecode&state=zzz',{Cookie:r.ck})).status===400);
 r=await run();
 const cb=await get('/api/auth/sso/callback?code=thecode&state='+r.state,{Cookie:r.ck});
 chk('good login redirects to /app/',cb.status===302&&cb.headers.get('location')==='/app/');
 chk('user created and session started',users.length===1&&sessions.length===1&&users[0].email==='ann@corp.com');
 r=await run();await get('/api/auth/sso/callback?code=thecode&state='+r.state,{Cookie:r.ck});
 chk('second login reuses the same user',users.length===1&&sessions.length===2);
 emailClaim='mallory@evil.com';r=await(async()=>{conn.domain='corp.com';const st=await get('/api/auth/sso/start?email=ann@corp.com');const loc=new URL(st.headers.get('location'));lastNonce=loc.searchParams.get('nonce');return{ck:st.headers.get('set-cookie').split(';')[0],state:loc.searchParams.get('state')}})();
 const bad=await get('/api/auth/sso/callback?code=thecode&state='+r.state,{Cookie:r.ck});
 chk('email outside the domain is rejected (403)',bad.status===403&&users.length===1);
 emailClaim='ann@corp.com';verified=false;r=await run();
 chk('unverified email is rejected (403)',(await get('/api/auth/sso/callback?code=thecode&state='+r.state,{Cookie:r.ck})).status===403);
 conn.enabled=false;chk('disabled connection is not sso',(await(await get('/api/auth/sso/lookup?email=a@corp.com')).json()).sso===false);
 web.close();idp.close();process.exit(ok?0:1)});
