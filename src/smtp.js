const {SMTPServer}=require('smtp-server');const {simpleParser}=require('mailparser');const fs=require('fs');
const {q}=require('./db');const {sha}=require('./auth');const {send}=require('./send');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const HOST=process.env.SMTP_HOSTNAME||'smtp.'+BASE;
const MAX=10*1024*1024;
const state={host:HOST,ports:[],enabled:false};
const fails=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of fails)if(n-v.t>600000)fails.delete(k)},60000).unref();
const note=ip=>{const v=fails.get(ip);fails.set(ip,{n:(v&&Date.now()-v.t<600000?v.n:0)+1,t:Date.now()})};
const err=(msg,code)=>Object.assign(new Error(msg),{responseCode:code});
const MAP={invalid_from:[550,'Invalid From address'],invalid_to:[550,'Invalid or too many recipients'],invalid_reply_to:[550,'Invalid Reply-To address'],invalid_subject:[550,'Invalid subject'],empty_body:[550,'Message has no body'],
 invalid_attachment:[550,'Invalid attachment'],attachment_not_allowed:[550,'Attachment type is not allowed'],attachments_too_large:[552,'Attachments are too large'],invalid_header:[550,'Invalid header'],
 domain_not_verified:[550,'5.7.1 Sender domain is not verified in your Geserd account'],all_recipients_suppressed:[550,'5.1.1 All recipients are on your suppression list'],
 quota_exceeded:[452,'4.5.3 Sending limit reached for your plan'],rate_limited:[451,'4.7.1 Too fast, retry shortly'],send_failed:[451,'4.3.0 Temporary problem, retry later'],spam_rejected:[554,'5.7.1 Message rejected as spam']};
function tlsOpts(){try{return{key:fs.readFileSync(process.env.SMTP_TLS_KEY),cert:fs.readFileSync(process.env.SMTP_TLS_CERT)}}catch{return null}}
const lower=a=>String(a||'').toLowerCase();
const addrs=h=>(h&&h.value?h.value:[]).map(x=>lower(x.address)).filter(Boolean);
async function handle(sess,raw){
 const p=await simpleParser(raw);
 const to=addrs(p.to),cc=addrs(p.cc),seen=new Set([...to,...cc]);
 const bcc=sess.envelope.rcptTo.map(r=>lower(r.address)).filter(a=>!seen.has(a));
 const f=p.from&&p.from.value&&p.from.value[0];
 const rt=addrs(p.replyTo)[0];
 const headers={};for(const k of['list-unsubscribe','list-unsubscribe-post','x-entity-ref-id','x-priority']){if(p.headers.has(k)){const v=p.headers.get(k);headers[k]=typeof v==='string'?v:(v&&v.text)||''}}
 const body={from:f?(f.name?'"'+String(f.name).replace(/["\\\r\n]/g,'')+'" <'+f.address+'>':f.address):'',to,cc,bcc,reply_to:rt,subject:p.subject||'',html:p.html||null,text:p.text||null,headers,
  attachments:(p.attachments||[]).map(a=>({filename:a.filename||'attachment',content:a.content,content_type:a.contentType,cid:a.related?a.cid:undefined}))};
 return send(sess.user.id,body,sess.user.keyId)}
function make(secure,t){
 const srv=new SMTPServer({secure,key:t.key,cert:t.cert,name:HOST,banner:'Geserd SMTP',authMethods:['PLAIN','LOGIN'],authOptional:false,allowInsecureAuth:false,size:MAX,maxClients:30,socketTimeout:90000,closeTimeout:4000,disableReverseLookup:true,
  onAuth(auth,sess,cb){
   const ip=sess.remoteAddress,v=fails.get(ip);
   if(v&&v.n>=10&&Date.now()-v.t<600000)return cb(err('Too many failed attempts, try again later',421));
   const pw=String(auth.password||'');
   if(!pw.startsWith('gs_')||pw.length>200){note(ip);return setTimeout(()=>cb(err('Invalid username or password',535)),400)}
   q('update api_keys set last_used_at=now() where key_hash=$1 and revoked_at is null returning id,user_id',[sha(pw)]).then(r=>{
    if(!r[0]){note(ip);return setTimeout(()=>cb(err('Invalid username or password',535)),400)}
    cb(null,{user:{id:r[0].user_id,keyId:r[0].id}})},e=>{console.error('smtp auth',e.message);cb(err('Temporary authentication failure',454))})},
  onRcptTo(a,sess,cb){if(sess.envelope.rcptTo.length>=50)return cb(err('Too many recipients',452));cb()},
  onData(stream,sess,cb){
   const ch=[];let n=0;stream.on('data',b=>{n+=b.length;if(n<=MAX)ch.push(b)});
   stream.on('end',()=>{
    if(stream.sizeExceeded)return cb(err('Message too large',552));
    handle(sess,Buffer.concat(ch)).then(r=>cb(null,'Queued as '+r.id),e=>{
     if(e&&e.code&&MAP[e.code]){const[c,m]=MAP[e.code];return cb(err(m+(e.code==='domain_not_verified'&&e.extra.domain?' ('+e.extra.domain+')':''),c))}
     console.error('smtp handle',e&&e.message);cb(err('Temporary local problem, try again later',451))})})}});
 srv.on('error',e=>console.error('smtp submission',e.message));
 return srv}
function start(){
 if(process.env.SMTP_SUBMISSION==='off'){console.log('smtp submission: disabled');return}
 const t=tlsOpts();if(!t){console.log('smtp submission: no TLS certificate (SMTP_TLS_KEY / SMTP_TLS_CERT), not started');return}
 const bind=process.env.SMTP_BIND||'0.0.0.0';
 const defs=[[+process.env.SMTP_TLS_PORT||465,true],[+process.env.SMTP_STARTTLS_PORT||587,false]];
 const servers=[];
 for(const[port,secure]of defs){
  const s=make(secure,t);
  s.server.once('error',e=>{if(e.code==='EADDRINUSE'||e.code==='EACCES')console.error('smtp submission: cannot bind port '+port+' ('+e.code+'); set '+(secure?'SMTP_TLS_PORT':'SMTP_STARTTLS_PORT')+' in .env')});
  s.listen(port,bind,()=>{state.ports.push({port,mode:secure?'ssl':'starttls'});state.ports.sort((a,b)=>a.port-b.port);state.enabled=true;console.log('smtp submission on '+bind+':'+port+(secure?' (implicit TLS)':' (STARTTLS)'))});
  servers.push(s)}
 setInterval(()=>{const n=tlsOpts();if(n)for(const s of servers)try{s.updateSecureContext(n)}catch(e){console.error('smtp tls reload',e.message)}},6*3600000).unref();
 return servers}
module.exports={start,state};
