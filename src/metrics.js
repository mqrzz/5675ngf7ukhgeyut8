const {q}=require('./db');const PLANS=require('./plans');
const dom=a=>{const m=/@([^@>\s]+)>?\s*$/.exec(String(a||''));return m?m[1].toLowerCase():''};
const COLS=['sent','delivered','bounced','complained','delayed','failed','suppressed','received'];
const KNOWN=new Set(['sent','delivered','bounced','complained','delayed','failed','received']);
const HR="(date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC')";
const DAY="((now() at time zone 'UTC')::date)";
async function bump(e,type,d){
 if(!KNOWN.has(type))return;d=d||{};
 const to=Array.isArray(e.to_addrs)?e.to_addrs:[];
 const domain=e.direction==='in'?dom(to[0]):dom(e.from_addr);
 const c={sent:0,delivered:0,bounced:0,complained:0,delayed:0,failed:0,suppressed:0,received:0};
 if(type==='sent'){c.sent=Math.max(1,Array.isArray(d.accepted)?d.accepted.length:1);c.suppressed=Array.isArray(d.suppressed)?d.suppressed.length:0}
 else if(type==='failed')c.failed=Math.max(1,to.length);
 else c[type]=1;
 await q('insert into metric_hours(user_id,hr,domain,'+COLS.join(',')+') values($1,'+HR+',$2,'+COLS.map((_,i)=>'$'+(i+3)).join(',')+') on conflict(user_id,hr,domain) do update set '+COLS.map(x=>x+'=metric_hours.'+x+'+excluded.'+x).join(','),[e.user_id,domain,...COLS.map(x=>c[x])]);
 if(e.direction==='out'&&(type==='delivered'||type==='bounced'||type==='complained')&&d.recipient){
  const rd=dom(d.recipient);
  if(rd)await q('insert into metric_rcpt(user_id,day,domain,rdomain,'+type+') values($1,'+DAY+',$2,$3,1) on conflict(user_id,day,domain,rdomain) do update set '+type+'=metric_rcpt.'+type+'+1',[e.user_id,domain,rd.slice(0,253)])
 }
 if(e.direction==='out'&&type==='bounced'){
  const dsn=String(d.dsn||'').slice(0,10)||'unknown';
  await q('insert into metric_bounce(user_id,day,domain,dsn,n) values($1,'+DAY+',$2,$3,1) on conflict(user_id,day,domain,dsn) do update set n=metric_bounce.n+1',[e.user_id,domain,dsn])
 }
}
const RANGES=[1,7,15,30,90,365];
const TARGET={bounce:4,complaint:0.08},BAD={bounce:8,complaint:0.3};
const pct=(a,b)=>b>0?Math.round(a/b*10000)/100:null;
const iso=d=>d.toISOString().replace(/\.\d+Z$/,'Z');
function windowOf(days,now){
 const n=now||new Date();
 if(days===1){const end=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),n.getUTCHours()+1));const start=new Date(end.getTime()-24*3600000);return{unit:'hour',step:3600000,start,end,len:24}}
 const end=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate()+1));const start=new Date(end.getTime()-days*86400000);return{unit:'day',step:86400000,start,end,len:days}
}
async function range(uid,w,domain){
 const args=[uid,iso(w.start),iso(w.end)];let f='';if(domain){args.push(domain);f=' and domain=$4'}
 const rows=await q("select to_char(date_trunc('"+w.unit+"',hr at time zone 'UTC'),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') t,"+COLS.map(x=>'sum('+x+')::int '+x).join(',')+' from metric_hours where user_id=$1 and hr>=$2 and hr<$3'+f+' group by 1',args);
 const map=new Map(rows.map(r=>[r.t,r]));const series=[];const tot={};for(const k of COLS)tot[k]=0;
 for(let i=0;i<w.len;i++){const t=iso(new Date(w.start.getTime()+i*w.step)),r=map.get(t)||{};const o={t};for(const k of COLS){o[k]=r[k]||0;tot[k]+=o[k]}series.push(o)}
 return{series,totals:tot}
}
function rates(t){return{delivered:pct(t.delivered,t.sent),bounced:pct(t.bounced,t.sent),complained:pct(t.complained,t.sent)}}
function health(t){
 if(t.sent<20)return'none';const r=rates(t);
 if(r.bounced>=BAD.bounce||r.complained>=BAD.complaint)return'bad';
 if(r.bounced>=TARGET.bounce||r.complained>=TARGET.complaint)return'warn';
 return'good'
}
function score(t){
 if(t.sent<20)return null;const r=rates(t);
 const pb=Math.min(60,(r.bounced||0)/BAD.bounce*60),pc=Math.min(40,(r.complained||0)/BAD.complaint*40);
 return Math.max(0,Math.round(100-pb-pc))
}
async function report(uid,plan,days,domain,now){
 const P=PLANS[plan]||PLANS.free,max=P.metricDays;
 let d=RANGES.includes(days)?days:15,capped=false;
 if(d>max){d=RANGES.filter(x=>x<=max).pop()||1;capped=true}
 const w=windowOf(d,now),cur=await range(uid,w,domain);
 let prev=null;
 if(d*2<=max||d===1&&max>=2){
  const pw={unit:w.unit,step:w.step,len:w.len,start:new Date(w.start.getTime()-w.len*w.step),end:w.start};
  const p=await range(uid,pw,domain);prev={totals:p.totals,rates:rates(p.totals)}
 }
 const pa=[uid,iso(w.start).slice(0,10),iso(w.end).slice(0,10)];let pf='';if(domain){pa.push(domain);pf=' and domain=$4'}
 const rc=await q('select rdomain,sum(delivered)::int delivered,sum(bounced)::int bounced,sum(complained)::int complained from metric_rcpt where user_id=$1 and day>=$2 and day<$3'+pf+' group by 1 order by sum(delivered)+sum(bounced) desc,rdomain limit 8',pa);
 const bn=await q('select dsn,sum(n)::int n from metric_bounce where user_id=$1 and day>=$2 and day<$3'+pf+' group by 1 order by sum(n) desc,dsn limit 8',pa);
 const dm=await q("select distinct domain from metric_hours where user_id=$1 and hr>=$2 and hr<$3 and domain<>'' order by 1 limit 50",[uid,iso(w.start),iso(w.end)]);
 return{days:d,bucket:w.unit,max_days:max,ranges:RANGES.filter(x=>x<=max),capped,from:iso(w.start),to:iso(w.end),series:cur.series,totals:cur.totals,rates:rates(cur.totals),prev,health:health(cur.totals),score:score(cur.totals),targets:TARGET,limits:BAD,recipients:rc.map(r=>({domain:r.rdomain,delivered:r.delivered,bounced:r.bounced,complained:r.complained})),bounces:bn.map(r=>({dsn:r.dsn,n:r.n})),domains:dm.map(r=>r.domain)}
}
async function prune(){
 for(const[p,v]of Object.entries(PLANS)){
  const a=[p,String(v.metricDays)];
  await q("delete from metric_hours m using users u where m.user_id=u.id and u.plan=$1 and m.hr<now()-($2||' days')::interval",a);
  await q("delete from metric_rcpt m using users u where m.user_id=u.id and u.plan=$1 and m.day<(now()-($2||' days')::interval)::date",a);
  await q("delete from metric_bounce m using users u where m.user_id=u.id and u.plan=$1 and m.day<(now()-($2||' days')::interval)::date",a)
 }
}
module.exports={bump,report,prune,dom,windowOf,rates,health,score,RANGES};
