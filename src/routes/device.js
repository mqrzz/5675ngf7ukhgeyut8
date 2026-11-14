const r=require('express').Router();
const {q}=require('../db');const {sha,w}=require('../auth');
const MA=require('../multiacct');const DG=require('../devicegate');
r.get('/check',w(async(req,res)=>{
 res.set('Cache-Control','no-store');
 const m=/(?:^|; )gs_sid=([^;]+)/.exec(req.headers.cookie||'');
 let su=null;
 if(m){const[x]=await q('select u.id,u.status from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now()',[sha(m[1])]);su=x||null}
 if(su&&su.status!=='blocked'){
  const ua=req.headers['user-agent']?String(req.headers['user-agent']).slice(0,300):null;
  MA.saveDevice(su.id,MA.device(req),ua).catch(()=>{})}
 const blocked=(su&&su.status==='blocked')||(await DG.verdict(req))==='blocked';
 DG.mark(res,!!blocked);
 res.json({blocked:!!blocked,session:su?{status:su.status}:null})}));
module.exports=r;
