const r=require('express').Router();const c=require('crypto');const dns=require('dns').promises;const {q}=require('../db');const {w,need}=require('../auth');const {enc}=require('../secret');
const LIM={free:1,pro:3,business:10,enterprise:1000},RX=/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const rec=d=>[{purpose:'dkim',type:'TXT',name:d.dkim_selector+'._domainkey',value:'v=DKIM1; k=rsa; p='+d.dkim_public},
 {purpose:'spf',type:'TXT',name:'@',value:'v=spf1 ip4:'+process.env.SERVER_IP+' ~all'},
 {purpose:'mx',type:'MX',name:'@',value:process.env.MAIL_HOST,priority:10},
 {purpose:'dmarc',type:'TXT',name:'_dmarc',value:'v=DMARC1; p=none'}];
const txt=async n=>{try{return(await dns.resolveTxt(n)).map(a=>a.join(''))}catch{return[]}};
async function check(d){const dkim=(await txt(d.dkim_selector+'._domainkey.'+d.name)).some(t=>t.replace(/\s/g,'').includes('p='+d.dkim_public));
 const spf=(await txt(d.name)).some(t=>t.startsWith('v=spf1')&&t.includes('ip4:'+process.env.SERVER_IP));
 let mx=false;try{mx=(await dns.resolveMx(d.name)).some(m=>m.exchange.replace(/\.$/,'').toLowerCase()===process.env.MAIL_HOST.toLowerCase())}catch{}
 return{dkim,spf,mx}}
const pub=d=>({id:d.id,name:d.name,status:d.status,sending_ok:d.sending_ok,receiving_ok:d.receiving_ok,created_at:d.created_at,records:rec(d)});
r.use(need);
r.get('/',w(async(req,res)=>res.json((await q('select * from domains where user_id=$1 order by created_at desc',[req.user.id])).map(pub))));
r.post('/',w(async(req,res)=>{const name=String(req.body.name||'').trim().toLowerCase();if(!RX.test(name))return res.status(400).json({error:'invalid_domain'});
 const [u]=await q('select plan from users where id=$1',[req.user.id]);const n=(await q('select count(*)::int n from domains where user_id=$1',[req.user.id]))[0].n;
 if(n>=(LIM[u.plan]||1))return res.status(403).json({error:'plan_limit'});
 if((await q('select 1 from domains where name=$1 and user_id=$2',[name,req.user.id])).length)return res.status(409).json({error:'exists'});
 const {publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});
 const [d]=await q('insert into domains(user_id,name,dkim_selector,dkim_public,dkim_private_enc) values($1,$2,$3,$4,$5) returning *',[req.user.id,name,process.env.DKIM_SELECTOR||'geserd',publicKey.export({type:'spki',format:'der'}).toString('base64'),enc(privateKey.export({type:'pkcs8',format:'pem'}))]);
 res.status(201).json(pub(d))}));
const own=w(async(req,res,next)=>{const [d]=await q('select * from domains where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!d)return res.status(404).json({error:'not_found'});req.d=d;next()});
r.get('/:id',own,(req,res)=>res.json(pub(req.d)));
r.post('/:id/verify',own,w(async(req,res)=>{const ck=await check(req.d),ok=ck.dkim&&ck.spf;
 try{const [d]=await q("update domains set status=$2,sending_ok=$3,receiving_ok=$4,verified_at=case when $3 then coalesce(verified_at,now()) else null end where id=$1 returning *",[req.d.id,ok?'verified':'pending',ok,ok&&ck.mx]);res.json({...pub(d),checks:ck})}
 catch(e){if(e.code==='23505')return res.status(409).json({error:'domain_taken'});throw e}}));
r.delete('/:id',own,w(async(req,res)=>{await q('delete from domains where id=$1',[req.d.id]);res.json({ok:true})}));
module.exports=r;
