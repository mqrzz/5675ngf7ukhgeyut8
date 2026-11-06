const fs=require('fs'),path=require('path'),net=require('net');
const DIR=process.env.VPN_DATA_DIR||path.join(__dirname,'..','data');
const SEED=path.join(__dirname,'..','data','vpn-seed.txt'),CACHE=path.join(DIR,'vpn-cache.txt');
const SOURCES=[
 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt',
 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv6.txt',
 'https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/vpn-ipv4/list.json',
 'https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/vpn-ipv6/list.json',
 'https://check.torproject.org/torbulkexitlist',
 'https://raw.githubusercontent.com/SecOps-Institute/Tor-IP-Addresses/master/tor-exit-nodes.lst',
 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/tor_exits.ipset'
];
if(process.env.VPN_INCLUDE_DATACENTER==='1')SOURCES.push('https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt');
const EXTRA=(process.env.VPN_EXTRA_SOURCES||'').split(',').map(s=>s.trim()).filter(Boolean);
const MAX_BYTES=12*1024*1024,EVERY=24*3600*1000;
let v4s=new Uint32Array(0),v4e=new Uint32Array(0),v6s=[],v6e=[],count=0,updated=null,source='none';
function ip4(s){const p=s.split('.');if(p.length!==4)return null;let n=0;for(const x of p){if(!/^\d{1,3}$/.test(x)||+x>255)return null;n=n*256+ +x}return n}
function ip6(s){
 s=s.split('%')[0];if(!net.isIPv6(s))return null;
 let tail=null;const m=s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
 if(m){const v=ip4(m[2]);if(v===null)return null;s=m[1]+((v>>>16)&0xffff).toString(16)+':'+(v&0xffff).toString(16)}
 const parts=s.split('::');if(parts.length>2)return null;
 const a=parts[0]?parts[0].split(':'):[],b=parts.length===2&&parts[1]?parts[1].split(':'):[];
 const miss=8-a.length-b.length;if(parts.length===1&&miss!==0)return null;if(miss<0)return null;
 const all=a.concat(Array(parts.length===2?miss:0).fill('0'),b);if(all.length!==8)return null;
 let n=0n;for(const g of all){if(!/^[0-9a-fA-F]{1,4}$/.test(g))return null;n=(n<<16n)|BigInt(parseInt(g,16))}return n}
function parseEntry(t,a4,a6){
 t=t.trim().replace(/^["',\s]+|["',\s]+$/g,'');if(!t||t[0]==='#'||t[0]===';')return;
 t=t.split(/[\s;#]/)[0];
 const i=t.indexOf('/'),host=i<0?t:t.slice(0,i);
 if(host.indexOf(':')<0){
  const base=ip4(host);if(base===null)return;let bits=i<0?32:+t.slice(i+1);if(!(bits>=0&&bits<=32))return;
  const size=bits===0?4294967296:Math.pow(2,32-bits),start=Math.floor(base/size)*size;a4.push([start,start+size-1])
 }else{
  const base=ip6(host);if(base===null)return;let bits=i<0?128:+t.slice(i+1);if(!(bits>=0&&bits<=128))return;
  const sh=BigInt(128-bits),start=(base>>sh)<<sh;a6.push([start,start|((1n<<sh)-1n)])
 }
}
function parseText(txt,a4,a6){
 const s=txt.trimStart();
 if(s[0]==='{'||s[0]==='['){try{const j=JSON.parse(s);const arr=Array.isArray(j)?j:j.list||[];for(const x of arr)parseEntry(String(x),a4,a6);return}catch{}}
 for(const l of txt.split(/\r?\n/))parseEntry(l,a4,a6)
}
function build(a4,a6){
 a4.sort((x,y)=>x[0]-y[0]);const m4=[];for(const r of a4){const l=m4[m4.length-1];if(l&&r[0]<=l[1]+1){if(r[1]>l[1])l[1]=r[1]}else m4.push([r[0],r[1]])}
 a6.sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0);const m6=[];for(const r of a6){const l=m6[m6.length-1];if(l&&r[0]<=l[1]+1n){if(r[1]>l[1])l[1]=r[1]}else m6.push([r[0],r[1]])}
 return{m4,m6}
}
function install(m4,m6,src){
 v4s=Uint32Array.from(m4.map(x=>x[0]));v4e=Uint32Array.from(m4.map(x=>x[1]));v6s=m6.map(x=>x[0]);v6e=m6.map(x=>x[1]);count=m4.length+m6.length;updated=new Date();source=src
}
function loadFile(f,src){
 const a4=[],a6=[];parseText(fs.readFileSync(f,'utf8'),a4,a6);const b=build(a4,a6);if(b.m4.length+b.m6.length<200)throw new Error('too few entries');install(b.m4,b.m6,src);
 try{updated=fs.statSync(f).mtime}catch{}
}
function load(){
 for(const [f,s] of [[CACHE,'cache'],[SEED,'seed']]){try{loadFile(f,s);return true}catch{}}
 return false
}
async function grab(u){
 const ac=new AbortController(),to=setTimeout(()=>ac.abort(),30000);
 try{const r=await fetch(u,{signal:ac.signal,headers:{'user-agent':'geserd-vpn-list/1'}});if(!r.ok)throw new Error('http '+r.status);
  const buf=Buffer.from(await r.arrayBuffer());if(buf.length>MAX_BYTES)throw new Error('too large');return buf.toString('utf8')}
 finally{clearTimeout(to)}
}
let busy=false;
async function refresh(){
 if(busy)return{ok:false,reason:'busy'};busy=true;
 try{
  const a4=[],a6=[];let okSrc=0;const fails=[];
  const res=await Promise.allSettled(SOURCES.concat(EXTRA).map(grab));
  res.forEach((r,i)=>{if(r.status==='fulfilled'){parseText(r.value,a4,a6);okSrc++}else fails.push((SOURCES.concat(EXTRA)[i]||'')+' '+(r.reason&&r.reason.message))});
  const b=build(a4,a6),n=b.m4.length+b.m6.length;
  if(okSrc===0||n<1000||(count&&n<count*0.5)){console.warn('vpn lists: refresh rejected',{sources_ok:okSrc,entries:n,previous:count,fails});return{ok:false,entries:n}}
  install(b.m4,b.m6,'live');
  try{writeCache(b)}catch(e){console.warn('vpn lists: cache not written',e.message)}
  if(fails.length)console.warn('vpn lists: some sources failed',fails);
  return{ok:true,entries:n,sources_ok:okSrc}
 }catch(e){console.warn('vpn lists: refresh failed',e.message);return{ok:false}}
 finally{busy=false}
}
function ntoa(n){return[n>>>24&255,n>>>16&255,n>>>8&255,n&255].join('.')}
function cidrs4(s,e){const out=[];let cur=s;while(cur<=e){let bits=32;while(bits>0){const size=Math.pow(2,32-bits+1);if(cur%size!==0||cur+size-1>e)break;bits--}out.push(ntoa(cur)+'/'+bits);cur+=Math.pow(2,32-bits)}return out}
function ntoa6(n){const g=[];for(let i=7;i>=0;i--)g.push(Number((n>>BigInt(i*16))&0xffffn).toString(16));return g.join(':')}
function cidrs6(s,e){const out=[];let cur=s;while(cur<=e){let bits=128;while(bits>0){const sh=BigInt(128-bits+1);const size=1n<<sh;if(cur%size!==0n||cur+size-1n>e)break;bits--}out.push(ntoa6(cur)+'/'+bits);cur+=1n<<BigInt(128-bits)}return out}
function writeCache(b){
 fs.mkdirSync(DIR,{recursive:true});const lines=['# Geserd VPN list cache, written '+new Date().toISOString()];
 for(const r of b.m4)lines.push(...cidrs4(r[0],r[1]));for(const r of b.m6)lines.push(...cidrs6(r[0],r[1]));
 const tmp=CACHE+'.tmp';fs.writeFileSync(tmp,lines.join('\n')+'\n');fs.renameSync(tmp,CACHE)
}
function has4(n){let lo=0,hi=v4s.length-1;while(lo<=hi){const mid=(lo+hi)>>1;if(v4s[mid]>n)hi=mid-1;else if(v4e[mid]<n)lo=mid+1;else return true}return false}
function has6(n){let lo=0,hi=v6s.length-1;while(lo<=hi){const mid=(lo+hi)>>1;if(v6s[mid]>n)hi=mid-1;else if(v6e[mid]<n)lo=mid+1;else return true}return false}
function isPrivate4(n){return n>>>24===10||n>>>24===127||n>>>24===0||(n>>>16)===0xc0a8||(n>>>20)===0xac1||(n>>>16)===0xa9fe||(n>>>22)===0x191}
function check(ip){
 ip=String(ip||'').replace(/^::ffff:/i,'');
 if(ip.indexOf(':')<0){const n=ip4(ip);if(n===null||isPrivate4(n))return false;return has4(n)}
 const n=ip6(ip);if(n===null||n===1n)return false;if((n>>121n)===0x7en||(n>>118n)===0x3fan)return false;return has6(n)
}
function middleware(req,res){res.set('Cache-Control','no-store');res.json({vpn:check(req.ip)})}
const OPEN=/^\/api\/(vpn|geo|health|maintenance|status|contact|unsubscribe|track)(\/|$)|^\/api\/billing\/robokassa\/(result|success|fail)$/;
const OFF=process.env.VPN_BLOCK==='0';
function enforce(req,res,next){
 if(OFF)return next();
 const path=req.originalUrl.split('?')[0];
 if(OPEN.test(path))return next();
 if(/^bearer\s/i.test(String(req.headers.authorization||'')))return next();
 if(!check(req.ip))return next();
 res.set('Cache-Control','no-store');
 res.status(403).json({error:'vpn_blocked'})
}
function stats(){return{entries:count,updated_at:updated,source,sources:SOURCES.length+EXTRA.length}}
let timer=null;
function start(){
 load();
 if(process.env.VPN_NO_REFRESH==='1')return;
 setTimeout(()=>{refresh()},8000).unref();
 timer=setInterval(()=>{refresh()},EVERY);timer.unref()
}
module.exports={start,refresh,check,middleware,enforce,stats,_parseText:parseText,_build:build,_install:install};
