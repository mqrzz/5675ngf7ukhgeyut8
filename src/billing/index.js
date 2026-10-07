const {q,pool}=require('../db');const P=require('../../config/prices.json');const PLANS=require('../plans');
const {notify}=require('../notify');
const provider=require('./robokassa');
const ORDER={free:0,pro:1,business:2,enterprise:3};
const DAY=86400000;
function price(plan){const p=P.plans[plan];return p?p.amount:null}
function title(plan,kind){return'Geserd '+plan.charAt(0).toUpperCase()+plan.slice(1)+(kind==='renewal'?' (renewal)':' (30 days)')}
async function subOf(uid){const[s]=await q('select * from subscriptions where user_id=$1',[uid]);return s||null}
function credit(user,sub,fromPlan){
 if(!sub||!sub.current_period_end||ORDER[fromPlan]<=0)return 0;
 const left=Math.max(0,new Date(sub.current_period_end).getTime()-Date.now());
 return Math.floor(price(fromPlan)*Math.min(1,left/(P.period_days*DAY)))
}
async function quote(uid,plan){
 const[u]=await q('select plan,onboarded_at,email,lang from users where id=$1',[uid]);
 if(!u)throw Object.assign(new Error('no_user'),{code:'no_user'});
 if(!u.onboarded_at)throw Object.assign(new Error('onboarding_required'),{code:'onboarding_required'});
 if(price(plan)==null)throw Object.assign(new Error('invalid_plan'),{code:'invalid_plan'});
 if(u.plan==='enterprise')throw Object.assign(new Error('contact_sales'),{code:'contact_sales'});
 const sub=await subOf(uid),active=sub&&sub.status!=='canceled'&&sub.current_period_end&&new Date(sub.current_period_end)>new Date();
 if(active&&ORDER[plan]<ORDER[u.plan])throw Object.assign(new Error('downgrade_at_period_end'),{code:'downgrade_at_period_end'});
 const cr=active&&u.plan!==plan?credit(u,sub,u.plan):0;
 const same=active&&u.plan===plan;
 const amount=Math.max(10,price(plan)-cr);
 return{user:u,sub,amount,credit:cr,kind:same?'renewal':(active?'change':'initial'),plan}
}
async function checkout(uid,plan,recurring,culture){
 const qt=await quote(uid,plan);
 const[inv]=await q("insert into invoices(user_id,plan,kind,amount,currency,provider) values($1,$2,$3,$4,$5,'robokassa') returning *",[uid,plan,qt.kind,qt.amount,P.currency]);
 await q("update invoices set provider_data=$2 where id=$1",[inv.id,JSON.stringify({recurring:!!recurring,credit:qt.credit})]);
 const url=provider.paymentUrl(inv,{description:title(plan),recurring:!!recurring,email:qt.user.email,culture,shp:{shp_user:uid}});
 return{url,invoice:{id:inv.id,amount:inv.amount,currency:inv.currency,plan}}
}
async function settle(invId,outSum,raw){
 const c=await pool.connect();
 try{
  await c.query('begin');
  const{rows:[inv]}=await c.query('select * from invoices where id=$1 for update',[invId]);
  if(!inv){await c.query('rollback');return{status:'unknown_invoice'}}
  await c.query('insert into payment_events(invoice_id,kind,payload) values($1,$2,$3)',[invId,'result',JSON.stringify(raw)]);
  if(Math.abs(Number(inv.amount)-Number(outSum))>0.009){await c.query('commit');return{status:'amount_mismatch'}}
  if(inv.status==='paid'){await c.query('commit');return{status:'already_paid',inv}}
  const meta=inv.provider_data||{};
  const{rows:[sub]}=await c.query('select * from subscriptions where user_id=$1 for update',[inv.user_id]);
  const now=new Date(),auto=inv.parent_id!=null;
  const keep=(auto||inv.kind==='renewal')&&sub&&sub.current_period_end&&new Date(sub.current_period_end)>now&&sub.plan===inv.plan;
  const base=keep?new Date(sub.current_period_end):now;
  const end=new Date(base.getTime()+P.period_days*DAY);
  const recurring=auto?!!(sub&&sub.recurring):!!meta.recurring;
  const parent=auto?(sub&&sub.parent_invoice_id):(meta.recurring?inv.id:((sub&&sub.parent_invoice_id)||null));
  await c.query("update invoices set status='paid',paid_at=now(),period_start=$2,period_end=$3 where id=$1",[invId,base,end]);
  await c.query("insert into subscriptions(user_id,plan,status,recurring,parent_invoice_id,current_period_end,cancel_at_period_end,attempts,next_attempt_at,updated_at) values($1,$2,'active',$3,$4,$5,false,0,null,now()) on conflict(user_id) do update set plan=$2,status='active',recurring=$3,parent_invoice_id=coalesce($4,subscriptions.parent_invoice_id),current_period_end=$5,cancel_at_period_end=false,attempts=0,next_attempt_at=null,updated_at=now()",[inv.user_id,inv.plan,recurring,parent,end]);
  await c.query('update users set plan=$2 where id=$1',[inv.user_id,inv.plan]);
  await c.query('commit');
  await notify(inv.user_id,'billing','billing_paid',inv.plan+'|'+Number(inv.amount).toFixed(2),'/app/settings/billing/','paid:'+invId);
  return{status:'paid',inv}
 }catch(e){try{await c.query('rollback')}catch{}throw e}finally{c.release()}
}
async function cancel(uid){
 const s=await subOf(uid);if(!s||s.status==='canceled')return false;
 await q("update subscriptions set recurring=false,cancel_at_period_end=true,updated_at=now() where user_id=$1",[uid]);return true
}
async function resume(uid){
 const s=await subOf(uid);if(!s||!s.parent_invoice_id)return false;
 if(!s.current_period_end||new Date(s.current_period_end)<=new Date())return false;
 await q("update subscriptions set recurring=true,cancel_at_period_end=false,updated_at=now() where user_id=$1",[uid]);return true
}
async function failInvoice(id,why){await q("update invoices set status='failed',provider_data=coalesce(provider_data,'{}'::jsonb)||$2::jsonb where id=$1 and status='pending'",[id,JSON.stringify({error:why})])}
async function renewOne(s){
 const[inv]=await q("insert into invoices(user_id,plan,kind,amount,currency,provider,parent_id) values($1,$2,'renewal',$3,$4,'robokassa',$5) returning *",[s.user_id,s.plan,price(s.plan),P.currency,s.parent_invoice_id]);
 let r;try{r=await provider.charge(inv,s.parent_invoice_id,title(s.plan,'renewal'))}catch(e){r={ok:false,text:e.message}}
 if(r.ok)return true;
 await failInvoice(inv.id,r.text);
 const n=(s.attempts||0)+1,days=P.retry_days[Math.min(n-1,P.retry_days.length-1)];
 await q("update subscriptions set attempts=$2::int,status=case when $2::int>=$4::int then 'past_due' else status end,next_attempt_at=now()+($3||' days')::interval,updated_at=now() where user_id=$1",[s.user_id,n,String(days),P.retry_days.length]);
 notify(s.user_id,'billing','billing_failed',s.plan,'/app/settings/billing/','fail:'+inv.id);
 return false
}
async function tick(){
 const due=await q("select * from subscriptions where recurring and not cancel_at_period_end and parent_invoice_id is not null and plan<>'free' and current_period_end<=now()+interval '1 day' and (next_attempt_at is null or next_attempt_at<=now()) and not exists(select 1 from invoices i where i.user_id=subscriptions.user_id and i.kind='renewal' and i.status='pending' and i.created_at>now()-interval '36 hours') limit 20");
 for(const s of due){try{await renewOne(s)}catch(e){console.error('renew',e.message)}}
 const gone=await q("select user_id,plan from subscriptions where status<>'canceled' and plan<>'free' and ((current_period_end<now() and (not recurring or cancel_at_period_end)) or (current_period_end<now()-($1||' days')::interval))",[String(P.grace_days)]);
 const all=new Map();for(const g of gone)all.set(g.user_id,g);
 for(const g of all.values()){
  await q("update subscriptions set status='canceled',recurring=false,updated_at=now() where user_id=$1",[g.user_id]);
  await q("update users set plan='free' where id=$1 and plan<>'enterprise'",[g.user_id]);
  notify(g.user_id,'billing','billing_expired',g.plan,'/app/settings/billing/','exp:'+g.user_id+':'+Date.now())
 }
}
function start(){const t=setInterval(()=>tick().catch(e=>console.error('billing',e.message)),600000);t.unref();setTimeout(()=>tick().catch(e=>console.error('billing',e.message)),20000).unref()}
module.exports={provider,price,quote,checkout,settle,cancel,resume,subOf,failInvoice,tick,start,config:P};
