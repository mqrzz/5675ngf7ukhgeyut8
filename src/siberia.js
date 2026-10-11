const CFG=require('../config/siberia.json');const {q}=require('./db');
const EMAIL_RX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const W10=[2,4,10,3,5,9,4,6,8],W11=[7,2,4,10,3,5,9,4,6,8],W12=[3,7,2,4,10,3,5,9,4,6,8];
const ctl=(d,w)=>w.reduce((a,x,i)=>a+x*d[i],0)%11%10;
function innValid(v,len){
 const s=String(v||'');if(!/^\d+$/.test(s))return false;
 if(len&&s.length!==len)return false;
 const d=s.split('').map(Number);
 if(s.length===10)return ctl(d,W10)===d[9];
 if(s.length===12)return ctl(d,W11)===d[10]&&ctl(d,W12)===d[11];
 return false
}
function validate(b){
 const L=CFG.limits,o={},e=[];
 b=b||{};
 o.email=String(b.email||'').trim().toLowerCase();if(o.email.length>254||!EMAIL_RX.test(o.email))e.push('email');
 o.lang=['en','ru','fr','de'].includes(b.lang)?b.lang:'en';
 o.kind=String(b.kind||'');if(!CFG.kinds.includes(o.kind))e.push('kind');
 o.org_name=String(b.org_name||'').trim().replace(/\s+/g,' ');if(o.org_name.length<L.name_min||o.org_name.length>L.name_max)e.push('org_name');
 o.inn=String(b.inn||'').replace(/\s+/g,'');
 if(!e.includes('kind')&&!innValid(o.inn,o.kind==='company'?10:12))e.push('inn');
 o.region=String(b.region||'');if(!CFG.regions.some(r=>r.id===o.region))e.push('region');
 o.site=String(b.site||'').trim();
 if(o.site&&(o.site.length>L.site_max||!/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(o.site)))e.push('site');
 o.phone=String(b.phone||'').trim();
 if(o.phone&&(o.phone.length>L.phone_max||!/^[+\d][\d\s()\-]{5,}$/.test(o.phone)))e.push('phone');
 o.purpose=String(b.purpose||'').trim();if(o.purpose.length<L.purpose_min||o.purpose.length>L.purpose_max)e.push('purpose');
 return{ok:!e.length,fields:e,value:o}
}
async function attach(uid,email){
 const rows=await q("select id from siberia_applications where lower(email)=lower($1) and status='approved' limit 1",[email]);
 if(!rows.length)return false;
 await q("update users set tariff='siberia' where id=$1",[uid]);
 await q("update siberia_applications set user_id=$2 where id=$1 and user_id is null",[rows[0].id,uid]);
 return true
}
module.exports={validate,innValid,attach,CFG};
