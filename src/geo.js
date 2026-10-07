const cfg=require('../config/geo.json');
let db=null;try{db=require('geoip-lite')}catch(e){console.warn('geoip-lite not installed - run geserd-backend-update')}
const BLOCKED=new Set(cfg.blocked.map(s=>String(s).toUpperCase()));
const EXEMPT=[/^\/api\/geo(\/|$)/,/^\/api\/health$/,/^\/api\/billing\/robokassa\/(result|success|fail)$/];
function clean(ip){return String(ip||'').replace(/^::ffff:/,'')}
function lookup(req,forced){
 const ip=clean(forced||req.ip);
 try{const g=db&&db.lookup(ip);if(g&&g.country)return{country:String(g.country).toUpperCase(),ip,source:'local-db'}}catch(e){}
 return{country:null,ip,source:db?'unknown-ip':'no-db'}
}
function isBlocked(cc){return !!cc&&BLOCKED.has(String(cc).toUpperCase())}
function list(){return[...BLOCKED].sort()}
function enforce(req,res,next){
 const path=req.originalUrl.split('?')[0];
 if(EXEMPT.some(r=>r.test(path)))return next();
 const g=lookup(req);
 if(isBlocked(g.country)){res.set('Cache-Control','no-store');return res.status(451).json({error:'region_blocked',country:g.country})}
 next()
}
function check(req,res){
 const g=lookup(req);res.set('Cache-Control','no-store');
 res.status(isBlocked(g.country)?403:204).end()
}
function info(req,res){
 const probe=typeof req.query.ip==='string'&&/^[0-9a-fA-F:.]{3,45}$/.test(req.query.ip)?req.query.ip:null;
 const g=lookup(req,probe);res.set('Cache-Control','no-store');
 const out={country:g.country,blocked:isBlocked(g.country),blockedCountries:list(),checkedBy:'server'};
 if(req.query.debug!==undefined)Object.assign(out,{source:g.source,seen_ip:g.ip,x_forwarded_for:req.headers['x-forwarded-for']||null});
 res.json(out)
}
module.exports={lookup,isBlocked,list,enforce,check,info};
