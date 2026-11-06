const c=require('crypto'),dns=require('dns').promises,net=require('net'),http=require('http'),https=require('https');
const {q}=require('./db');
const BACKOFF=[30,120,600,1800,7200,21600];
function priv(ip){
 if(process.env.NODE_ENV==='test')return false;
 if(net.isIPv4(ip)){const [a,b]=ip.split('.').map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224}
 if(net.isIPv6(ip)){const l=ip.toLowerCase();return l==='::1'||l==='::'||l.startsWith('fc')||l.startsWith('fd')||l.startsWith('fe80')||l.startsWith('::ffff:')&&priv(l.slice(7))}
 return true}
async function safeTarget(u){
 let url;try{url=new URL(u)}catch{return null}
 if(url.protocol!=='https:'&&url.protocol!=='http:')return null;
 if(url.username||url.password)return null;
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(net.isIP(host))return priv(host)?null:{url,ip:host};
 let r;try{r=await dns.lookup(host,{all:true})}catch{return null}
 if(!r.length||r.some(x=>priv(x.address)))return null;
 return{url,ip:r[0].address}}
function sign(secret,id,ts,body){return 'v1='+c.createHmac('sha256',secret).update(id+'.'+ts+'.'+body).digest('hex')}
async function post(hook,delivery){
 const t=await safeTarget(hook.url);if(!t)return{ok:false,error:'blocked_or_unresolvable_url'};
 const body=JSON.stringify(delivery.payload),ts=Math.floor(Date.now()/1000),id='msg_'+delivery.id;
 const lib=t.url.protocol==='https:'?https:http;
 return new Promise(res=>{
  const rq=lib.request({host:t.ip,port:t.url.port||(t.url.protocol==='https:'?443:80),path:t.url.pathname+t.url.search,method:'POST',servername:t.url.hostname,timeout:10000,
   headers:{'Host':t.url.host,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'Geserd-Webhooks/1.0','Geserd-Id':id,'Geserd-Timestamp':String(ts),'Geserd-Signature':sign(hook.secret,id,ts,body)}},
   r=>{r.resume();r.on('end',()=>res({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,error:r.statusCode>=200&&r.statusCode<300?null:'http_'+r.statusCode}))});
  rq.on('timeout',()=>{rq.destroy();res({ok:false,error:'timeout'})});rq.on('error',e=>res({ok:false,error:String(e.code||e.message).slice(0,100)}));rq.end(body)})}
async function run(d){
 const [h]=await q('select * from webhooks where id=$1',[d.webhook_id]);
 if(!h||!h.active){await q("update webhook_deliveries set status='cancelled' where id=$1",[d.id]);return}
 const r=await post(h,d),n=d.attempts+1;
 if(r.ok)await q("update webhook_deliveries set status='delivered',attempts=$2,last_status=$3,last_error=null,delivered_at=now() where id=$1",[d.id,n,r.status||null]);
 else if(n>=BACKOFF.length+1)await q("update webhook_deliveries set status='failed',attempts=$2,last_status=$3,last_error=$4 where id=$1",[d.id,n,r.status||null,r.error]);
 else await q("update webhook_deliveries set attempts=$2,last_status=$3,last_error=$4,next_at=now()+($5||' seconds')::interval where id=$1",[d.id,n,r.status||null,r.error,String(BACKOFF[n-1])])}
let timer=null,busy=false;
async function tick(){
 if(busy)return;busy=true;
 try{const rows=await q("update webhook_deliveries set next_at=now()+interval '120 seconds' where id in(select id from webhook_deliveries where status='pending' and next_at<=now() order by next_at limit 10 for update skip locked) returning *");
  await Promise.all(rows.map(d=>run(d).catch(e=>console.error('webhook',e.message))))}
 catch(e){console.error('webhooks',e.message)}
 busy=false}
function start(){if(process.env.WEBHOOKS==='off')return;timer=setInterval(tick,2000);timer.unref()}
function stop(){if(timer)clearInterval(timer)}
module.exports={start,stop,tick,safeTarget,sign,post};
