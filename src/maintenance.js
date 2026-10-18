const {q}=require('./db');
let cache=null,at=0;
async function get(){
 if(cache&&Date.now()-at<4000)return cache;
 try{const[r]=await q('select active,scope,title,message,eta,updated_at from maintenance where id=1');cache=r||{active:false,scope:'all',title:'',message:'',eta:null};at=Date.now()}catch{cache=cache||{active:false,scope:'all',title:'',message:'',eta:null}}
 return cache;
}
function reset(){cache=null;at=0}
const OPEN=/^\/(health|status|maintenance|auth|admin|geo)(\/|$)/;
async function enforce(req,res,next){
 const m=await get();
 if(!m.active||OPEN.test(req.path))return next();
 if(m.scope==='sending'&&!(req.method==='POST'&&/^\/(emails|broadcasts)(\/|$)/.test(req.path)))return next();
 res.set('Retry-After','300');
 res.status(503).json({error:'maintenance',title:m.title,message:m.message,eta:m.eta});
}
const LANGS=['en','ru','fr','de'];
function cleanTexts(t){const o={};for(const l of LANGS){const x=(t||{})[l]||{};const title=String(x.title||'').trim().slice(0,120),message=String(x.message||'').trim().slice(0,1000);if(title||message)o[l]={title,message}}return o}
function pick(texts,lang){const x=(texts||{})[lang]||(texts||{}).en||Object.values(texts||{})[0]||{title:'',message:''};return x}
async function getNotice(){try{const[r]=await q('select active,texts,starts_at,ends_at,emailed_at,emailed_count,updated_at from maintenance_notice where id=1');return r||{active:false,texts:{},starts_at:null,ends_at:null}}catch{return{active:false,texts:{},starts_at:null,ends_at:null}}}
async function publicState(_,res){
 const m=await get(),n=await getNotice();res.set('Cache-Control','no-store');
 const live=n.active&&Object.keys(n.texts||{}).length&&(!n.ends_at||new Date(n.ends_at)>new Date());
 res.json({active:!!m.active,scope:m.scope,title:m.title,message:m.message,eta:m.eta,notice:live?{texts:n.texts,starts_at:n.starts_at,ends_at:n.ends_at}:null})}
module.exports={get,reset,enforce,publicState,getNotice,cleanTexts,pick,LANGS};
