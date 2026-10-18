const r=require('express').Router();const {q}=require('../db');const GEO=require('../geo');
const hits=new Map();
setInterval(()=>{const n=Date.now();for(const [k,v] of hits)if(v.t<n)hits.delete(k)},60000).unref();
function limited(ip){const n=Date.now();let v=hits.get(ip);if(!v||v.t<n){v={t:n+60000,c:0};hits.set(ip,v)}v.c++;return v.c>120}
const clip=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f]/g,' ').slice(0,n);
r.post('/',(req,res)=>{
 res.status(204).end();
 const b=req.body||{};const ip=req.ip;
 if(limited(ip))return;
 const kind=b.kind==='click'?'click':'view';const sid=clip(b.sid,40);const path=clip(b.path,300);
 if(!/^[a-z0-9]{8,40}$/i.test(sid)||!path.startsWith('/'))return;
 const g=GEO.lookup(req);const dev=Number(b.w)>0&&Number(b.w)<=820?'mobile':'desktop';
 q('insert into page_events(sid,kind,path,label,ref,lang,country,device) values($1,$2,$3,$4,$5,$6,$7,$8)',[sid,kind,path,clip(b.label,120),clip(b.ref,200),clip(b.lang,5),String(g.country||'').toUpperCase().slice(0,2),dev]).catch(()=>{})
});
module.exports=r;
