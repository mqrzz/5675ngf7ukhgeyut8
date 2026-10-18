const r=require('express').Router();
const hits=new Map();
setInterval(()=>{const n=Date.now();for(const [k,v] of hits)if(v.t<n)hits.delete(k)},60000).unref();
function limited(ip){const n=Date.now();let v=hits.get(ip);if(!v||v.t<n){v={t:n+60000,c:0};hits.set(ip,v)}v.c++;return v.c>20}
const cache=new Map();
function norm(s){
 s=String(s||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/[\/?#].*$/,'').replace(/\.$/,'');
 try{s=require('url').domainToASCII(s)}catch{s=''}
 return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+xn--[a-z0-9-]{2,59}$/.test(s)?s:''
}
function ev(o,a){const e=(o.events||[]).find(x=>x.eventAction===a);return e?e.eventDate:null}
function ent(o,role){const e=(o.entities||[]).find(x=>(x.roles||[]).includes(role));if(!e||!e.vcardArray)return null;const f=(e.vcardArray[1]||[]).find(x=>x[0]==='fn');return f?String(f[3]).slice(0,200):null}
r.get('/',async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(limited(req.ip))return res.status(429).json({error:'rate_limited'});
 const d=norm(req.query.domain);if(!d)return res.status(400).json({error:'bad_domain'});
 const c=cache.get(d);if(c&&c.t>Date.now())return res.json(c.v);
 try{
  const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),8000);
  const x=await fetch('https://rdap.org/domain/'+encodeURIComponent(d),{signal:ac.signal,headers:{accept:'application/rdap+json'},redirect:'follow'});clearTimeout(tm);
  if(x.status===404)return res.json({domain:d,registered:false});
  if(!x.ok)return res.status(502).json({error:'lookup_failed'});
  const o=await x.json();
  const ns=(o.nameservers||[]).map(n=>String(n.ldhName||'').toLowerCase()).filter(Boolean).slice(0,12);
  const v={domain:d,registered:true,status:(o.status||[]).slice(0,10),registrar:ent(o,'registrar'),created:ev(o,'registration'),updated:ev(o,'last changed'),expires:ev(o,'expiration'),nameservers:ns,dnssec:!!(o.secureDNS&&o.secureDNS.delegationSigned)};
  cache.set(d,{t:Date.now()+300000,v});if(cache.size>500)cache.delete(cache.keys().next().value);
  res.json(v)
 }catch{res.status(502).json({error:'lookup_failed'})}
});
module.exports=r;
