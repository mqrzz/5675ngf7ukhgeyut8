const cfg=require('../config/geo.json');
let db=null;try{db=require('geoip-lite')}catch(e){console.warn('geoip-lite not installed - run geserd-backend-update')}
const BLOCKED=new Set(cfg.blocked.map(s=>String(s).toUpperCase()));
const EXEMPT=[/^\/api\/geo(\/|$)/,/^\/api\/health$/,/^\/api\/unsubscribe\//,/^\/api\/contact(\/|$)/,/^\/api\/billing\/robokassa\/(result|success|fail)$/];
function clean(ip){return String(ip||'').replace(/^::ffff:/,'')}
const fs=require('fs');
const MMDB=process.env.GEO_MMDB||'/var/lib/geserd/geo/dbip-country.mmdb';
let mm=null,mmStamp=0,mmChecked=0;
function loadMm(){
 const now=Date.now();if(now-mmChecked<60000)return;mmChecked=now;
 let st;try{st=fs.statSync(MMDB)}catch(e){mm=null;mmStamp=0;return}
 if(st.mtimeMs===mmStamp)return;mmStamp=st.mtimeMs;
 require('maxmind').open(MMDB).then(r=>{mm=r}).catch(e=>{mm=null;console.warn('geo mmdb not readable:',e.message)})
}
function fromMm(ip){try{loadMm();const r=mm&&mm.get(ip);const c=r&&((r.country&&r.country.iso_code)||(r.registered_country&&r.registered_country.iso_code));return c?String(c).toUpperCase():null}catch(e){return null}}
function fromLite(ip){try{const g=db&&db.lookup(ip);return g&&g.country?String(g.country).toUpperCase():null}catch(e){return null}}
function lookup(req,forced){
 const ip=clean(forced||req.ip);
 const a=fromMm(ip),b=fromLite(ip);
 const found=[a,b].filter(Boolean);
 const country=a||b||null;
 const agree=found.length>0&&found.every(x=>x===found[0]);
 return{country,ip,agree,sources:{dbip:a,lite:b},source:a?'dbip':b?'lite':(db||mm?'unknown-ip':'no-db')}
}
function isBlocked(cc){return !!cc&&BLOCKED.has(String(cc).toUpperCase())}
function blockedBy(g){return g.agree&&isBlocked(g.country)}
function list(){return[...BLOCKED].sort()}
function enforce(req,res,next){
 const path=req.originalUrl.split('?')[0];
 if(EXEMPT.some(r=>r.test(path)))return next();
 const g=lookup(req);
 if(blockedBy(g)){res.set('Cache-Control','no-store');return res.status(451).json({error:'region_blocked'})}
 next()
}
function check(req,res){
 const g=lookup(req);res.set('Cache-Control','no-store');
 res.status(blockedBy(g)?403:204).end()
}
function info(req,res){
 const probe=typeof req.query.ip==='string'&&/^[0-9a-fA-F:.]{3,45}$/.test(req.query.ip)?req.query.ip:null;
 const g=lookup(req,probe);res.set('Cache-Control','no-store');
 const out={blocked:blockedBy(g),blockedCountries:list()};
 if(req.query.debug!==undefined)Object.assign(out,{country:g.country,sources:g.sources,agree:g.agree,seen_ip:g.ip,x_forwarded_for:req.headers['x-forwarded-for']||null});
 res.json(out)
}
module.exports={lookup,isBlocked,list,enforce,check,info};
