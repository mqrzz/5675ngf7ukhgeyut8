const r=require('express').Router();
const net=require('net');const tls=require('tls');const dns=require('dns');
let geo=null;try{geo=require('geoip-lite')}catch{}
const hits=new Map();
setInterval(()=>{const n=Date.now();for(const [k,v] of hits)if(v.t<n)hits.delete(k)},60000).unref();
function limited(ip){const n=Date.now();let v=hits.get(ip);if(!v||v.t<n){v={t:n+60000,c:0};hits.set(ip,v)}v.c++;return v.c>20}
const cache=new Map();
let boot=null,bootAt=0;
const RDAP_FALLBACK={com:'https://rdap.verisign.com/com/v1/',net:'https://rdap.verisign.com/net/v1/',org:'https://rdap.publicinterestregistry.org/rdap/',info:'https://rdap.identitydigital.services/rdap/',io:'https://rdap.identitydigital.services/rdap/',ai:'https://rdap.identitydigital.services/rdap/',dev:'https://pubapi.registry.google/rdap/',app:'https://pubapi.registry.google/rdap/',de:'https://rdap.denic.de/',fr:'https://rdap.nic.fr/',eu:'https://rdap.eu/',uk:'https://rdap.nominet.uk/uk/',nl:'https://rdap.sidn.nl/',ch:'https://rdap.nic.ch/',me:'https://rdap.identitydigital.services/rdap/',co:'https://rdap.nic.co/',xyz:'https://rdap.centralnic.com/xyz/',online:'https://rdap.centralnic.com/online/',site:'https://rdap.centralnic.com/site/',tech:'https://rdap.centralnic.com/tech/'};
const WHOIS_HOST={ru:'whois.tcinet.ru',su:'whois.tcinet.ru','xn--p1ai':'whois.tcinet.ru',by:'whois.cctld.by',kz:'whois.nic.kz',ua:'whois.ua'};
function norm(s){
 s=String(s||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/[\/?#].*$/,'').replace(/:\d+$/,'').replace(/\.$/,'').replace(/^www\./,'');
 try{s=require('url').domainToASCII(s)}catch{s=''}
 return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(s)?s:''
}
const tmo=(p,ms,tag)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(tag||'timeout')),ms))]);
async function jget(url,ms){
 const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),ms);
 try{return await fetch(url,{signal:ac.signal,headers:{accept:'application/rdap+json, application/json','user-agent':'Geserd-lookup/1.0'},redirect:'follow'})}finally{clearTimeout(tm)}
}
async function rdapBases(tld){
 const list=[];
 try{
  if(!boot||Date.now()-bootAt>86400000){const x=await jget('https://data.iana.org/rdap/dns.json',6000);if(x.ok){boot=await x.json();bootAt=Date.now()}}
  if(boot)for(const [tlds,urls] of boot.services||[])if(tlds.includes(tld)){for(const u of urls)if(u.startsWith('https://'))list.push(u);break}
 }catch{}
 if(RDAP_FALLBACK[tld]&&!list.includes(RDAP_FALLBACK[tld]))list.push(RDAP_FALLBACK[tld]);
 list.push('https://rdap.org/');
 return list
}
const ev=(o,a)=>{const e=(o.events||[]).find(x=>x.eventAction===a);return e?e.eventDate:null};
function vc(e,key){if(!e||!e.vcardArray)return null;const f=(e.vcardArray[1]||[]).find(x=>x[0]===key);return f?f[3]:null}
function ent(o,role){return (o.entities||[]).find(x=>(x.roles||[]).includes(role))||null}
function adr(e){const a=vc(e,'adr');return Array.isArray(a)?String(a[a.length-1]||'').slice(0,60)||null:null}
function parseRdap(d,o){
 const reg=ent(o,'registrar'),rt=ent(o,'registrant'),ab=reg&&(reg.entities||[]).find(x=>(x.roles||[]).includes('abuse'));
 const iana=reg&&(reg.publicIds||[]).find(p=>/iana/i.test(p.type||''));
 return{registered:true,source:'rdap',status:(o.status||[]).slice(0,12),registrar:reg?String(vc(reg,'fn')||'').slice(0,200)||null:null,registrarIana:iana?String(iana.identifier).slice(0,12):null,abuseEmail:ab?String(vc(ab,'email')||'').slice(0,120)||null:null,
  created:ev(o,'registration'),updated:ev(o,'last changed'),expires:ev(o,'expiration'),
  nameservers:(o.nameservers||[]).map(n=>String(n.ldhName||'').toLowerCase()).filter(Boolean).slice(0,12),
  dnssec:!!(o.secureDNS&&o.secureDNS.delegationSigned),registrantOrg:rt?String(vc(rt,'org')||'').slice(0,120)||null:null,registrantCountry:rt?adr(rt):null}
}
async function viaRdap(d){
 const tld=d.split('.').pop();let last=null;
 for(const base of await rdapBases(tld)){
  try{
   const x=await jget(base.replace(/\/?$/,'/')+'domain/'+encodeURIComponent(d),8000);
   if(x.status===404)return{registered:false,source:'rdap'};
   if(!x.ok){last=new Error('rdap '+x.status);continue}
   return parseRdap(d,await x.json())
  }catch(e){last=e}
 }
 throw last||new Error('no rdap')
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
const pick=(t,re)=>{const m=t.match(re);return m?m[1].trim():null};
function toIso(s){if(!s)return null;const m=s.match(/(\d{4})[-.\/](\d{2})[-.\/](\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];const n=Date.parse(s);return isNaN(n)?null:new Date(n).toISOString().slice(0,10)}
async function viaWhois(d){
 const tld=d.split('.').pop();
 let host=WHOIS_HOST[tld];
 if(!host){const ia=await tcp('whois.iana.org',tld,6000);host=pick(ia,/^(?:refer|whois):\s*(\S+)/im)}
 if(!host)throw new Error('no whois server');
 const t=await tcp(host,d,9000);
 if(/no match|not found|no entries found|no data found|is free|status:\s*free|domain not found/i.test(t)&&!/registrar|nserver|name server/i.test(t))return{registered:false,source:'whois'};
 const ns=[...t.matchAll(/^(?:name server|nserver):\s*(\S+)/gim)].map(m=>m[1].toLowerCase().replace(/\.$/,'')).filter((v,i,a)=>a.indexOf(v)===i).slice(0,12);
 const st=[...t.matchAll(/^(?:domain )?(?:status|state):\s*(.+)$/gim)].map(m=>m[1].trim().slice(0,80)).slice(0,8);
 if(!ns.length&&!st.length&&!/registrar|creat/i.test(t))throw new Error('unparsed');
 return{registered:true,source:'whois',status:st,registrar:pick(t,/^registrar:\s*(.+)$/im),registrarIana:pick(t,/^registrar iana id:\s*(\d+)/im),abuseEmail:pick(t,/^registrar abuse contact email:\s*(\S+)/im),
  created:toIso(pick(t,/^(?:creation date|created|registered):\s*(.+)$/im)),updated:toIso(pick(t,/^(?:updated date|last updated|last-modified|changed):\s*(.+)$/im)),
  expires:toIso(pick(t,/^(?:registry expiry date|registrar registration expiration date|paid-till|expir\w* date|expires):\s*(.+)$/im)),
  nameservers:ns,dnssec:/dnssec:\s*(signeddelegation|yes|signed)/i.test(t),registrantOrg:pick(t,/^(?:registrant organi[sz]ation|org):\s*(.+)$/im),registrantCountry:pick(t,/^registrant country:\s*(\S+)/im)}
}
async function registry(d){
 let e1,e2;
 try{return{ok:true,...await viaRdap(d)}}catch(e){e1=e}
 try{return{ok:true,...await viaWhois(d)}}catch(e){e2=e}
 console.error('whois',d,e1&&e1.message,e2&&e2.message);
 return{ok:false,error:'registry_unavailable'}
}
const RES=new dns.promises.Resolver({timeout:3000,tries:1});
const safe=async(p)=>{try{return await tmo(p,5000)}catch{return null}};
function isPrivate(ip){
 if(net.isIPv4(ip)){const [a,b]=ip.split('.').map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224}
 const l=ip.toLowerCase();return l==='::1'||l==='::'||l.startsWith('fc')||l.startsWith('fd')||l.startsWith('fe80')||l.startsWith('::ffff:')
}
async function dnsInfo(d){
 const [A,AAAA,NS,MX,TXT,CAA,SOA,CNAME]=await Promise.all([safe(RES.resolve4(d)),safe(RES.resolve6(d)),safe(RES.resolveNs(d)),safe(RES.resolveMx(d)),safe(RES.resolveTxt(d)),safe(RES.resolveCaa(d)),safe(RES.resolveSoa(d)),safe(RES.resolveCname(d))]);
 const txt=(TXT||[]).map(a=>a.join('')).slice(0,20).map(s=>s.slice(0,400));
 const dm=await safe(RES.resolveTxt('_dmarc.'+d));
 const dmarc=(dm||[]).map(a=>a.join('')).find(s=>/^v=DMARC1/i.test(s))||null;
 const spf=txt.find(s=>/^v=spf1/i.test(s))||null;
 return{a:(A||[]).slice(0,10),aaaa:(AAAA||[]).slice(0,10),ns:(NS||[]).map(s=>s.toLowerCase()).sort().slice(0,12),mx:(MX||[]).sort((x,y)=>x.priority-y.priority).slice(0,10).map(m=>({priority:m.priority,host:m.exchange.toLowerCase()})),txt,caa:(CAA||[]).slice(0,10).map(c=>({tag:c.issue?'issue':c.issuewild?'issuewild':c.iodef?'iodef':'other',value:String(c.issue||c.issuewild||c.iodef||'').slice(0,120)})),
  soa:SOA?{host:SOA.nsname,admin:SOA.hostmaster,serial:SOA.serial}:null,cname:(CNAME||[])[0]||null,
  mail:{mx:!!(MX&&MX.length),spf,dmarc,dmarcPolicy:dmarc?((dmarc.match(/;\s*p=(\w+)/i)||[])[1]||'').toLowerCase():null}}
}
async function ptr(ip){const x=await safe(RES.reverse(ip));return x&&x[0]?x[0].toLowerCase():null}
async function hosting(ips){
 const out=[];
 for(const ip of ips.slice(0,4)){
  const g=geo?geo.lookup(ip):null;
  out.push({ip,country:g?g.country:null,region:g?g.region||null:null,city:g?g.city||null:null,ptr:isPrivate(ip)?null:await ptr(ip)})
 }
 return out
}
function certInfo(d,ip){
 return new Promise(res=>{
  if(!ip||isPrivate(ip))return res(null);
  let done=false;const fin=v=>{if(!done){done=true;res(v)}};
  const s=tls.connect({host:ip,port:443,servername:d,rejectUnauthorized:false,timeout:5000},()=>{
   const c=s.getPeerCertificate();const proto=s.getProtocol();const authorized=s.authorized;
   const to=c&&c.valid_to?new Date(c.valid_to):null;
   const san=c&&c.subjectaltname?String(c.subjectaltname).split(/,\s*/).map(x=>x.replace(/^DNS:/,'')).slice(0,12):[];
   fin(c&&c.subject?{issuer:(c.issuer&&(c.issuer.O||c.issuer.CN))||null,subject:(c.subject&&c.subject.CN)||null,validFrom:c.valid_from?new Date(c.valid_from).toISOString():null,validTo:to&&!isNaN(to)?to.toISOString():null,daysLeft:to&&!isNaN(to)?Math.floor((to-Date.now())/864e5):null,protocol:proto,trusted:authorized,san}:null);
   s.destroy()});
  s.on('timeout',()=>{s.destroy();fin(null)});s.on('error',()=>fin(null));s.on('close',()=>fin(null))
 })
}
const dayDiff=(a,b)=>Math.floor((a-b)/864e5);
r.get('/',async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(limited(req.ip))return res.status(429).json({error:'rate_limited'});
 const d=norm(req.query.domain);if(!d)return res.status(400).json({error:'bad_domain'});
 const c=cache.get(d);if(c&&c.t>Date.now())return res.json(c.v);
 try{
  const [reg,dn]=await Promise.all([registry(d),dnsInfo(d)]);
  const ips=[...dn.a,...dn.aaaa];
  const [host,cert]=await Promise.all([hosting(ips),certInfo(d,dn.a[0]||dn.aaaa[0])]);
  const now=Date.now();
  if(reg.ok&&reg.registered){
   const cr=reg.created?Date.parse(reg.created):NaN,ex=reg.expires?Date.parse(reg.expires):NaN;
   reg.ageDays=isNaN(cr)?null:dayDiff(now,cr);reg.daysLeft=isNaN(ex)?null:dayDiff(ex,now)
  }
  const hasDns=!!(dn.ns.length||dn.a.length||dn.aaaa.length||dn.mx.length||dn.soa);
  const v={domain:d,unicode:require('url').domainToUnicode(d)||d,tld:d.split('.').pop(),registry:reg,dns:dn,hosting:host,tls:cert,hasDns,checked:new Date().toISOString()};
  if(!reg.ok&&!hasDns)return res.status(502).json({error:'lookup_failed'});
  cache.set(d,{t:now+300000,v});if(cache.size>500)cache.delete(cache.keys().next().value);
  res.json(v)
 }catch(e){console.error('whois',d,e&&e.message);res.status(502).json({error:'lookup_failed'})}
});
module.exports=r;
