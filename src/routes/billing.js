const r=require('express').Router();const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');
const B=require('../billing');const PROV=B.provider;const REG=require('../regions');
const result=w(async(req,res)=>{
 const src=Object.assign({},req.query,req.body||{});
 const v=PROV.verifyResult(src);
 res.set('Content-Type','text/plain; charset=utf-8').set('Cache-Control','no-store');
 if(!v.ok){console.warn('robokassa result rejected',v.reason,String(src.InvId||'').slice(0,12));return res.status(400).send('bad sign')}
 const out=await B.settle(v.invId,v.outSum,{OutSum:src.OutSum,InvId:src.InvId,shp:v.shp});
 if(out.status==='unknown_invoice'||out.status==='amount_mismatch'){console.warn('robokassa result',out.status,v.invId);return res.status(400).send(out.status)}
 res.send('OK'+v.invId)
});
r.get('/robokassa/result',result);
r.post('/robokassa/result',result);
r.get('/robokassa/success',w(async(req,res)=>{
 const v=PROV.verifySuccess(req.query);
 res.set('Cache-Control','no-store');
 res.redirect('/app/settings/billing/?'+(v.ok?'paid='+v.invId:'check='+encodeURIComponent(String(req.query.InvId||'').replace(/\D/g,'').slice(0,10))))
}));
r.get('/robokassa/fail',w(async(req,res)=>{
 const id=String(req.query.InvId||'').replace(/\D/g,'').slice(0,10);
 res.set('Cache-Control','no-store');
 res.redirect('/app/settings/billing/?failed='+id)
}));
r.use(need,sessionOnly);
r.get('/',w(async(req,res)=>{
 const uid=req.user.id;
 const[u]=await q('select plan,region,currency,data_region,onboarded_at from users where id=$1',[uid]);
 const sub=await B.subOf(uid);
 const inv=await q("select id,plan,kind,amount,currency,status,created_at,paid_at,period_start,period_end from invoices where user_id=$1 and (status<>'pending' or created_at>now()-interval '1 day') order by created_at desc limit 30",[uid]);
 const pol=u.region?REG.policy(u.region):null;
 res.set('Cache-Control','no-store');
 res.json({
  plan:u.plan,onboarded:!!u.onboarded_at,region:u.region,currency:B.config.currency,display:pol?pol.display:null,data_region:u.data_region,
  provider:{name:PROV.name,configured:PROV.configured(),test:PROV.env().test},
  subscription:sub&&{plan:sub.plan,status:sub.status,recurring:sub.recurring,cancel_at_period_end:sub.cancel_at_period_end,current_period_end:sub.current_period_end,attempts:sub.attempts,next_attempt_at:sub.next_attempt_at},
  prices:Object.fromEntries(Object.entries(B.config.plans).map(([k,v])=>[k,v.amount])),period_days:B.config.period_days,invoices:inv})
}));
r.post('/quote',w(async(req,res)=>{
 try{const qt=await B.quote(req.user.id,String(req.body.plan||''));res.json({plan:qt.plan,kind:qt.kind,amount:qt.amount,credit:qt.credit,currency:B.config.currency})}
 catch(e){if(e.code)return res.status(400).json({error:e.code});throw e}
}));
r.post('/checkout',w(async(req,res)=>{
 if(!PROV.configured())return res.status(503).json({error:'provider_not_configured'});
 try{
  const lang=String((req.body||{}).lang||'');
  const out=await B.checkout(req.user.id,String(req.body.plan||''),req.body.recurring!==false,lang==='ru'?'ru':'en');
  res.json(out)
 }catch(e){if(e.code)return res.status(400).json({error:e.code});throw e}
}));
r.post('/cancel',w(async(req,res)=>{const ok=await B.cancel(req.user.id);if(!ok)return res.status(400).json({error:'no_subscription'});res.json({ok:true})}));
r.post('/resume',w(async(req,res)=>{const ok=await B.resume(req.user.id);if(!ok)return res.status(400).json({error:'cannot_resume'});res.json({ok:true})}));
module.exports=r;
