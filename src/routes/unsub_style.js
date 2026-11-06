const r=require('express').Router();const {q}=require('../db');const {w,need}=require('../auth');
const HEX=/^#[0-9a-f]{6}$/i;
const DEF={bg:'#050508',tx:'#edeef0',accent:'#363a3f',hide_branding:false};
r.use(need);
const paid=async req=>{const[u]=await q('select plan from users where id=$1',[req.user.id]);return !!u&&u.plan!=='free'};
r.get('/',w(async(req,res)=>{const[s]=await q('select bg,tx,accent,hide_branding from unsub_style where user_id=$1',[req.user.id]);res.json({...DEF,...(s||{}),can_hide:await paid(req)})}));
r.put('/',w(async(req,res)=>{
 const b=req.body||{};const v={};
 for(const k of ['bg','tx','accent']){const x=String(b[k]||DEF[k]).trim();if(!HEX.test(x))return res.status(422).json({error:'invalid_color'});v[k]=x.toLowerCase()}
 const can=await paid(req);const hide=b.hide_branding===true&&can;
 await q('insert into unsub_style(user_id,bg,tx,accent,hide_branding) values($1,$2,$3,$4,$5) on conflict(user_id) do update set bg=$2,tx=$3,accent=$4,hide_branding=$5,updated_at=now()',[req.user.id,v.bg,v.tx,v.accent,hide]);
 res.json({...v,hide_branding:hide,can_hide:can})}));
r.delete('/',w(async(req,res)=>{await q('delete from unsub_style where user_id=$1',[req.user.id]);res.json({...DEF,can_hide:await paid(req)})}));
module.exports=r;
