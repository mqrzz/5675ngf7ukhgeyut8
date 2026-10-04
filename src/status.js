const net=require('net');const {q}=require('./db');
const COMPONENTS=['api','database','sending','inbound','smtp','webhooks'];
const probe=(port,host)=>new Promise(res=>{const s=net.connect({port,host:host||'127.0.0.1'});let d=false;const f=v=>{if(d)return;d=true;s.destroy();res(v)};s.setTimeout(2500,()=>f(false));s.on('connect',()=>f(true));s.on('error',()=>f(false))});
async function run(){
 const out={api:true};
 try{await q('select 1');out.database=true}catch{out.database=false}
 out.sending=await probe(25);
 out.inbound=process.env.INBOUND_PORT==='off'?null:await probe(+process.env.INBOUND_PORT||2525);
 const sm=require('./smtp').state;out.smtp=sm.enabled?await probe(sm.ports[0].port):null;
 try{const [{n}]=await q("select count(*)::int n from webhook_deliveries where status='pending' and next_at<now()-interval '10 minutes'");out.webhooks=n===0}catch{out.webhooks=false}
 return out}
let last={at:0,v:null};
async function current(){if(last.v&&Date.now()-last.at<20000)return last.v;last={at:Date.now(),v:await run()};return last.v}
async function sample(){
 const v=await current();
 for(const k of COMPONENTS){if(v[k]==null)continue;
  await q('insert into status_days(day,component,checks,fails) values(current_date,$1,1,$2) on conflict(day,component) do update set checks=status_days.checks+1,fails=status_days.fails+excluded.fails',[k,v[k]?0:1])}}
function start(){
 const t=setInterval(()=>sample().catch(e=>console.error('status sample',e.message)),60000);t.unref();
 setTimeout(()=>sample().catch(()=>{}),8000).unref()}
async function report(){
 const v=await current();
 const days=await q("select to_char(day,'YYYY-MM-DD') as day,component,checks,fails from status_days where day>current_date-90 order by day");
 const hist={};for(const k of COMPONENTS)hist[k]=[];
 for(const d of days)if(hist[d.component])hist[d.component].push({day:d.day,uptime:d.checks?Math.round((1-d.fails/d.checks)*10000)/100:null});
 const comps=COMPONENTS.filter(k=>v[k]!=null).map(k=>{const h=hist[k],tot=days.filter(d=>d.component===k).reduce((a,d)=>({c:a.c+d.checks,f:a.f+d.fails}),{c:0,f:0});return{id:k,ok:v[k],uptime:tot.c?Math.round((1-tot.f/tot.c)*10000)/100:null,history:h}});
 const incidents=await q("select id,title,body,component,status,impact,started_at,resolved_at from incidents where resolved_at is null or resolved_at>now()-interval '30 days' order by started_at desc limit 30");
 const down=comps.filter(c=>!c.ok).length,open=incidents.some(i=>!i.resolved_at&&i.impact!=='minor');
 return{state:down||open?(down>=3?'major':'degraded'):'ok',checked_at:new Date().toISOString(),components:comps,incidents}}
module.exports={start,report,COMPONENTS};
