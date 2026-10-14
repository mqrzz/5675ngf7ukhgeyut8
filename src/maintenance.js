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
async function publicState(_,res){const m=await get();res.set('Cache-Control','no-store');res.json({active:!!m.active,scope:m.scope,title:m.title,message:m.message,eta:m.eta})}
module.exports={get,reset,enforce,publicState};
