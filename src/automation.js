const {q}=require('./db');const {send}=require('./send');
const MAXSTEPS=10,MAXWAIT=60*24*30;
function cleanSteps(s){
 if(!Array.isArray(s))return[];const out=[];
 for(const x of s.slice(0,MAXSTEPS)){
  if(x&&x.type==='wait'){const m=Math.floor(Number(x.minutes));if(m>=1&&m<=MAXWAIT)out.push({type:'wait',minutes:m})}
  else if(x&&x.type==='send'&&/^[0-9a-f-]{36}$/i.test(String(x.template_id||''))&&typeof x.from==='string'&&x.from.length<320)out.push({type:'send',template_id:String(x.template_id),from:x.from.trim()})}
 return out}
async function fire(userId,name,email,data){
 const rows=await q('select id from automations where user_id=$1 and enabled and trigger_event=$2',[userId,name]);
 for(const a of rows)await q('insert into automation_runs(automation_id,email,payload) values($1,$2,$3)',[a.id,email.toLowerCase(),JSON.stringify(data||{})]);
 return rows.length}
async function tick(){
 const due=await q("update automation_runs set status='running' where id in(select id from automation_runs where status='pending' and run_at<=now() order by run_at limit 20 for update skip locked) returning *");
 for(const r of due){
  try{
   const [a]=await q('select user_id,steps,enabled from automations where id=$1',[r.automation_id]);
   if(!a||!a.enabled){await q("update automation_runs set status='cancelled',finished_at=now() where id=$1",[r.id]);continue}
   let i=r.step_idx;const steps=a.steps||[];
   while(i<steps.length){
    const s=steps[i];
    if(s.type==='wait'){await q("update automation_runs set status='pending',step_idx=$2,run_at=now()+($3||' minutes')::interval where id=$1",[r.id,i+1,String(s.minutes)]);i=-1;break}
    if(s.type==='send'){await send(a.user_id,{from:s.from,to:[r.email],template_id:s.template_id,variables:{email:r.email,...(r.payload||{})}},null);i++}
   }
   if(i>=0)await q("update automation_runs set status='done',step_idx=$2,finished_at=now() where id=$1",[r.id,i])
  }catch(e){await q("update automation_runs set status='failed',error=$2,finished_at=now() where id=$1",[r.id,String((e&&e.code)||e.message).slice(0,200)])}}}
function startWorker(){const t=setInterval(()=>tick().catch(e=>console.error('automation',e.message)),15000);t.unref()}
module.exports={cleanSteps,fire,tick,startWorker};
