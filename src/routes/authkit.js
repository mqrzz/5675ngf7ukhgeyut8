const r=require('express').Router();
const {w,need}=require('../auth');const {issue,check,stats}=require('../otp');const {status}=require('../send');
const ST={invalid_to:422,invalid_from:422,too_many_codes:429,cooldown:429};
r.use(need);
const fail=(res,e)=>res.status(ST[e.code]||status(e.code)).json({error:e.code,...e.extra});
r.post('/send',w(async(req,res)=>{try{res.json(await issue(req.user.id,req.user.keyId,req.body||{}))}catch(e){if(e&&e.code)return fail(res,e);throw e}}));
r.post('/verify',w(async(req,res)=>res.json(await check(req.user.id,req.body||{}))));
r.get('/stats',w(async(req,res)=>{if(req.user.via!=='session')return res.status(403).json({error:'session_required'});res.json(await stats(req.user.id))}));
module.exports=r;
