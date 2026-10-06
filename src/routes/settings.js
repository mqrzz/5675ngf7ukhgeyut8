const r=require('express').Router();
const {w,need,sessionOnly}=require('../auth');const S=require('../settings');
r.use(need,sessionOnly);
r.get('/sending',w(async(req,res)=>res.json(await S.get(req.user.id))));
r.patch('/sending',w(async(req,res)=>{
 try{res.json(await S.save(req.user.id,req.body))}
 catch(e){if(e&&e.code)return res.status(400).json({error:e.code});throw e}}));
module.exports=r;
