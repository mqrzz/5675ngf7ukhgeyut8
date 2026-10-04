const r=require('express').Router();
const {q}=require('../db');const {w,need}=require('../auth');
const {send,check,status}=require('../send');
r.use(need);
r.post('/',w(async(req,res)=>{
 try{res.json(await send(req.user.id,req.body||{},req.user.keyId))}
 catch(e){if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}
}));
r.post('/check',w(async(req,res)=>{
 try{res.json(await check(req.user.id,req.body||{}))}
 catch(e){if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}
}));
r.get('/',w(async(req,res)=>{
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25));const args=[req.user.id];let where='user_id=$1';
 if(req.query.direction==='in'||req.query.direction==='out'){args.push(req.query.direction);where+=' and direction=$'+args.length}
 if(req.query.status){args.push(String(req.query.status));where+=' and status=$'+args.length}
 if(req.query.before){const t=new Date(req.query.before);if(!isNaN(t)){args.push(t.toISOString());where+=' and created_at<$'+args.length}}
 const rows=await q('select id,direction,from_addr,to_addrs,subject,status,created_at from emails where '+where+' order by created_at desc limit '+(lim+1),args);
 res.json({data:rows.slice(0,lim),next:rows.length>lim?rows[lim-1].created_at:null});
}));
r.get('/:id',w(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [e]=await q('select * from emails where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!e)return res.status(404).json({error:'not_found'});
 const ev=await q('select type,data,created_at from events where email_id=$1 order by created_at,id',[e.id]);
 res.json({id:e.id,direction:e.direction,from:e.from_addr,to:e.to_addrs,subject:e.subject,html:e.html,text:e.text_body,status:e.status,error:e.error,attachments:e.attachments||[],spam:e.spam_score==null?null:{score:+e.spam_score,rules:e.spam_rules||[]},in_reply_to:e.in_reply_to,created_at:e.created_at,events:ev});
}));
module.exports=r;
