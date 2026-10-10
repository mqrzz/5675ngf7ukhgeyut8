const {q}=require('./db');const PLANS=require('./plans');
const HIDE=/^(authorization|password|secret|token|api_key|apikey|key)$/i;
function clean(v,depth){
 if(depth>6)return'[deep]';
 if(typeof v==='string')return v.length>1500?v.slice(0,500)+'… ['+v.length+' chars]':v;
 if(Array.isArray(v)){const o=v.slice(0,50).map(x=>clean(x,depth+1));if(v.length>50)o.push('… ['+(v.length-50)+' more]');return o}
 if(v&&typeof v==='object'){
  if(Buffer.isBuffer(v))return'['+v.length+' bytes]';
  const o={};
  for(const k of Object.keys(v).slice(0,60)){
   if(HIDE.test(k))o[k]='[hidden]';
   else if(k==='content'&&typeof v[k]==='string'&&v[k].length>200)o[k]='['+Math.floor(v[k].length*3/4)+' bytes]';
   else if(k==='content'&&Buffer.isBuffer(v[k]))o[k]='['+v[k].length+' bytes]';
   else o[k]=clean(v[k],depth+1)
  }
  return o
 }
 return v
}
function pack(v){
 if(v===undefined||v===null)return null;
 const c=clean(v,0),s=JSON.stringify(c);
 if(s&&s.length>8000)return JSON.stringify({_truncated:true,preview:s.slice(0,2000)});
 return s
}
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>2000)hits.delete(k)},5000).unref();
function allow(uid){const n=Date.now(),v=hits.get(uid);if(!v||n-v.t>=1000){hits.set(uid,{t:n,n:1});return true}if(v.n>=10)return false;v.n++;return true}
async function record(o){
 try{
  if(!o.uid||!allow(o.uid))return;
  await q('insert into api_logs(user_id,key_id,method,path,status,ms,via,ip,ua,req,res) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[o.uid,o.keyId||null,String(o.method).slice(0,10),String(o.path).slice(0,300),o.status|0,Math.max(0,o.ms|0),o.via||'key',o.ip?String(o.ip).slice(0,64):null,o.ua?String(o.ua).slice(0,300):null,pack(o.req),pack(o.res)])
 }catch(e){console.error('apilog',e.message)}
}
function attach(req,res){
 const t0=Date.now();let body;const j=res.json.bind(res);
 res.json=function(b){body=b;return j(b)};
 res.on('finish',()=>{
  if(req.method==='OPTIONS')return;
  record({uid:req.user.id,keyId:req.user.keyId,method:req.method,path:req.originalUrl||req.url,status:res.statusCode,ms:Date.now()-t0,via:'key',ip:req.ip,ua:req.headers['user-agent'],req:req.body&&Object.keys(req.body).length?req.body:undefined,res:body})
 })
}
async function prune(){
 for(const[p,v]of Object.entries(PLANS))await q("delete from api_logs l using users u where l.user_id=u.id and u.plan=$1 and l.created_at<now()-($2||' days')::interval",[p,String(v.logDays)])
}
module.exports={attach,record,prune,clean,pack};
