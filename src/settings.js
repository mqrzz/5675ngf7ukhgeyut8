const net=require('net');const {q}=require('./db');
const DEFAULTS={default_from_name:'',default_reply_to:'',spam_block:'off',suppress_bounce:true,suppress_complaint:true,allowed_ips:[]};
const SPAM={off:0,balanced:8,strict:5};
const EMAIL=/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const cache=new Map();
setInterval(()=>{const n=Date.now();for(const[k,v]of cache)if(n-v.t>30000)cache.delete(k)},30000).unref();
async function get(uid){
 const c=cache.get(uid);if(c&&Date.now()-c.t<10000)return c.v;
 const [u]=await q('select send_settings from users where id=$1',[uid]);
 const v={...DEFAULTS,...((u&&u.send_settings)||{})};
 cache.set(uid,{t:Date.now(),v});return v}
function drop(uid){cache.delete(uid)}
function sanitize(input,cur){
 const o={...cur},b=input||{};
 if(b.default_from_name!==undefined){const v=String(b.default_from_name).trim();if(v.length>80||/[\r\n\u0000"<>]/.test(v))throw Object.assign(new Error('invalid_from_name'),{code:'invalid_from_name'});o.default_from_name=v}
 if(b.default_reply_to!==undefined){const v=String(b.default_reply_to).trim().toLowerCase();if(v&&!EMAIL.test(v))throw Object.assign(new Error('invalid_reply_to'),{code:'invalid_reply_to'});o.default_reply_to=v}
 if(b.spam_block!==undefined){if(!(b.spam_block in SPAM))throw Object.assign(new Error('invalid_spam_block'),{code:'invalid_spam_block'});o.spam_block=b.spam_block}
 if(b.suppress_bounce!==undefined)o.suppress_bounce=!!b.suppress_bounce;
 if(b.suppress_complaint!==undefined)o.suppress_complaint=!!b.suppress_complaint;
 if(b.allowed_ips!==undefined){
  const list=(Array.isArray(b.allowed_ips)?b.allowed_ips:String(b.allowed_ips).split(/[\s,;]+/)).map(x=>String(x).trim()).filter(Boolean);
  if(list.length>20||list.some(x=>!net.isIP(x)))throw Object.assign(new Error('invalid_ip'),{code:'invalid_ip'});
  o.allowed_ips=[...new Set(list)]}
 return o}
function ipAllowed(settings,ip){
 const list=settings.allowed_ips||[];if(!list.length)return true;
 const x=String(ip||'').replace(/^::ffff:/,'');return list.includes(x)}
async function save(uid,input){
 const cur=await get(uid),next=sanitize(input,cur);
 await q('update users set send_settings=$2 where id=$1',[uid,JSON.stringify(next)]);drop(uid);return next}
module.exports={get,save,drop,ipAllowed,SPAM,DEFAULTS};
