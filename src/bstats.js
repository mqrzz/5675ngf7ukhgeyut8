const {q}=require('./db');const PLANS=require('./plans');
const EX=t=>"exists(select 1 from events e where e.email_id=r.email_id and e.type='"+t+"')";
async function compute(b){
 const[s]=await q("select count(*) filter(where r.status='sent')::int sent,count(*) filter(where r.status='sent' and "+EX('delivered')+")::int delivered,count(*) filter(where r.status='sent' and "+EX('bounced')+")::int bounced,count(*) filter(where r.status='sent' and "+EX('complained')+")::int complained,count(*) filter(where r.status='sent' and ("+EX('delivered')+" or "+EX('bounced')+"))::int settled,count(*) filter(where r.status='failed')::int failed,count(*) filter(where r.status='skipped' and r.error='unsubscribed')::int skipped_unsub,count(*) filter(where r.status='skipped' and r.error<>'unsubscribed')::int skipped_other from broadcast_recipients r where r.broadcast_id=$1",[b.id]);
 const U="from broadcast_recipients r join contacts c on c.id=r.contact_id where r.broadcast_id=$1 and r.status='sent' and c.unsubscribed and c.unsubscribed_at>=$2 and not exists(select 1 from broadcast_recipients r2 join broadcasts b2 on b2.id=r2.broadcast_id where r2.contact_id=c.id and r2.status='sent' and b2.id<>$1 and b2.started_at>$2 and b2.started_at<=c.unsubscribed_at)";
 const since=b.started_at||b.created_at;
 const[u]=await q('select count(*)::int n '+U,[b.id,since]);
 const unsubList=await q('select c.email,c.unsubscribed_at at '+U+' order by c.unsubscribed_at desc limit 20',[b.id,since]);
 const tl=await q("select to_char(date_trunc('hour',e.created_at at time zone 'UTC'),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') t,e.type,count(*)::int n from broadcast_recipients r join events e on e.email_id=r.email_id where r.broadcast_id=$1 and e.type in('delivered','bounced','complained') group by 1,2 order by 1",[b.id]);
 const rs=await q("select coalesce(nullif(e.data->>'dsn',''),'unknown') dsn,count(*)::int n from broadcast_recipients r join events e on e.email_id=r.email_id where r.broadcast_id=$1 and e.type='bounced' group by 1 order by n desc,dsn limit 6",[b.id]);
 const bl=await q("select e.data->>'recipient' email,e.data->>'dsn' dsn,e.data->>'detail' detail,e.created_at at from broadcast_recipients r join events e on e.email_id=r.email_id where r.broadcast_id=$1 and e.type='bounced' order by e.id desc limit 20",[b.id]);
 const cl=await q("select coalesce(e.data->>'recipient',r.email) email,e.created_at at from broadcast_recipients r join events e on e.email_id=r.email_id where r.broadcast_id=$1 and e.type='complained' order by e.id desc limit 20",[b.id]);
 const hours=new Map();for(const x of tl){const o=hours.get(x.t)||{t:x.t,delivered:0,bounced:0,complained:0};o[x.type]=x.n;hours.set(x.t,o)}
 const p=(a,n)=>n>0?Math.round(a/n*10000)/100:null;
 return{sent:s.sent,delivered:s.delivered,bounced:s.bounced,complained:s.complained,in_transit:Math.max(0,s.sent-s.settled),failed:s.failed,unsubscribed:u.n,skipped:s.skipped_unsub+s.skipped_other,rates:{delivered:p(s.delivered,s.sent),bounced:p(s.bounced,s.sent),complained:p(s.complained,s.sent),unsubscribed:p(u.n,s.sent)},timeline:[...hours.values()].slice(0,96),reasons:rs,bounce_list:bl,complaint_list:cl,unsub_list:unsubList,computed_at:new Date().toISOString()}
}
async function get(b){
 const live=await compute(b);
 const old=b.stats&&typeof b.stats==='object'?b.stats:null;
 if(old&&live.sent>0&&live.delivered+live.bounced+live.complained===0&&old.delivered+old.bounced+old.complained>0)return{...old,archived:true};
 if(live.sent>0)await q('update broadcasts set stats=$2 where id=$1',[b.id,JSON.stringify(live)]);
 return{...live,archived:false}
}
async function snapshot(){
 for(const[p,v]of Object.entries(PLANS)){
  const rows=await q("select b.* from broadcasts b join users u on u.id=b.user_id where u.plan=$1 and b.sent>0 and coalesce(b.started_at,b.created_at)>now()-($2||' days')::interval limit 200",[p,String(v.logDays+2)]);
  for(const b of rows)try{await get(b)}catch(e){console.error('bstats',e.message)}
 }
}
module.exports={compute,get,snapshot};
