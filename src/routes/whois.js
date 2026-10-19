const r=require('express').Router();
const net=require('net');
const hits=new Map();
setInterval(()=>{const n=Date.now();for(const [k,v] of hits)if(v.t<n)hits.delete(k)},60000).unref();
function limited(ip){const n=Date.now();let v=hits.get(ip);if(!v||v.t<n){v={t:n+60000,c:0};hits.set(ip,v)}v.c++;return v.c>20}
const cache=new Map();
let boot=null,bootAt=0;
function norm(s){
 s=String(s||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/[\/?#].*$/,'').replace(/\.$/,'').replace(/^www\./,'');
 try{s=require('url').domainToASCII(s)}catch{s=''}
 return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(s)?s:''
}
async function jget(url,ms){
 const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),ms);
 try{const x=await fetch(url,{signal:ac.signal,headers:{accept:'application/rdap+json, application/json'},redirect:'follow'});return x}finally{clearTimeout(tm)}
}
async function rdapBase(tld){
 if(!boot||Date.now()-bootAt>86400000){
  const x=await jget('https://data.iana.org/rdap/dns.json',8000);
  if(!x.ok)throw new Error('bootstrap '+x.status);
  boot=await x.json();bootAt=Date.now()
 }
 for(const [tlds,urls] of boot.services||[]){if(tlds.includes(tld))return urls.find(u=>u.startsWith('https://'))||urls[0]}
 return null
}
function ev(o,a){const e=(o.events||[]).find(x=>x.eventAction===a);return e?e.eventDate:null}
function ent(o,role){const e=(o.entities||[]).find(x=>(x.roles||[]).includes(role));if(!e||!e.vcardArray)return null;const f=(e.vcardArray[1]||[]).find(x=>x[0]==='fn');return f?String(f[3]).slice(0,200):null}
async function viaRdap(d){
 const tld=d.split('.').pop();
 const base=await rdapBase(tld);
 if(!base)return undefined;
 const x=await jget(base.replace(/\/?$/,'/')+'domain/'+encodeURIComponent(d),9000);
 if(x.status===404)return{domain:d,registered:false};
 if(!x.ok)throw new Error('rdap '+x.status);
 const o=await x.json();
 return{domain:d,registered:true,status:(o.status||[]).slice(0,10),registrar:ent(o,'registrar'),created:ev(o,'registration'),updated:ev(o,'last changed'),expires:ev(o,'expiration'),nameservers:(o.nameservers||[]).map(n=>String(n.ldhName||'').toLowerCase()).filter(Boolean).slice(0,12),dnssec:!!(o.secureDNS&&o.secureDNS.delegationSigned)}
}
function tcp(host,query,ms){
 return new Promise((res,rej)=>{
  const s=net.connect(43,host);let b='';
  s.setTimeout(ms,()=>{s.destroy();rej(new Error('timeout'))});
  s.on('connect',()=>s.write(query+'\r\n'));
  s.on('data',c=>{b+=c.toString('utf8');if(b.length>200000)s.destroy()});
  s.on('error',rej);s.on('close',()=>res(b))
 })
}
function pick(t,re){const m=t.match(re);return m?m[1].trim():null}
function toIso(s){if(!s)return null;const m=s.match(/(\d{4})[-.\/](\d{2})[-.\/](\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];const n=Date.parse(s);return isNaN(n)?null:new Date(n).toISOString().slice(0,10)}
async function viaWhois(d){
 const tld=d.split('.').pop();
 const ia=await tcp('whois.iana.org',tld,6000);
 const host=pick(ia,/^(?:refer|whois):\s*(\S+)/im);
 if(!host)throw new Error('no whois server');
 const t=await tcp(host,d,9000);
 if(/no match|not found|no entries found|no data found|is free|status:\s*free|domain not found/i.test(t)&&!/registrar|nserver|name server/i.test(t))return{domain:d,registered:false};
 const ns=[...t.matchAll(/^(?:name server|nserver):\s*(\S+)/gim)].map(m=>m[1].toLowerCase().replace(/\.$/,'')).filter((v,i,a)=>a.indexOf(v)===i).slice(0,12);
 const st=[...t.matchAll(/^(?:domain )?(?:status|state):\s*(.+)$/gim)].map(m=>m[1].trim().slice(0,80)).slice(0,6);
 if(!ns.length&&!st.length&&!/registrar|creat/i.test(t))throw new Error('unparsed');
 return{domain:d,registered:true,status:st,registrar:pick(t,/^registrar:\s*(.+)$/im),created:toIso(pick(t,/^(?:creation date|created|registered):\s*(.+)$/im)),updated:toIso(pick(t,/^(?:updated date|last updated|last-modified|changed):\s*(.+)$/im)),expires:toIso(pick(t,/^(?:registry expiry date|registrar registration expiration date|paid-till|expir\w* date|expires):\s*(.+)$/im)),nameservers:ns,dnssec:/dnssec:\s*(signeddelegation|yes|signed)/i.test(t)}
}
r.get('/',async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(limited(req.ip))return res.status(429).json({error:'rate_limited'});
 const d=norm(req.query.domain);if(!d)return res.status(400).json({error:'bad_domain'});
 const c=cache.get(d);if(c&&c.t>Date.now())return res.json(c.v);
 let v,e1,e2;
 try{v=await viaRdap(d)}catch(e){e1=e}
 if(!v){try{v=await viaWhois(d)}catch(e){e2=e}}
 if(!v){console.error('whois',d,e1&&e1.message,e2&&e2.message);return res.status(502).json({error:'lookup_failed'})}
 cache.set(d,{t:Date.now()+300000,v});if(cache.size>500)cache.delete(cache.keys().next().value);
 res.json(v)
});
module.exports=r;
