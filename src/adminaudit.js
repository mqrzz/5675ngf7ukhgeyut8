const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURS=[1,3,5,12,24,48,72];
const CATS=['phishing','fraud','spam','malware','illegal','harassment','other'];
const ACTS=['watch','freeze','block'];
const clean=(s,n)=>String(s==null?'':s).replace(/\u0000/g,'').replace(/\s+/g,' ').trim().slice(0,n);
function mask(a){a=String(a||'');const i=a.lastIndexOf('@');if(i<1)return a.slice(0,1)+'***';return a.slice(0,1)+'***'+a.slice(i)}
function addrs(v){const out=[];(Array.isArray(v)?v:[v]).forEach(x=>{if(!x)return;if(typeof x==='string')out.push(x);else if(x.address)out.push(x.address);else if(x.email)out.push(x.email)});return out}
module.exports=function(r,d){
 const {q,w,act,setStatus,notifyFlag}=d;
 const hrs=req=>{const h=parseInt(req.query.hours,10);return HOURS.includes(h)?h:24};
 async function windowRows(h,limit){
  return q("select e.id,e.user_id,e.from_addr,e.to_addrs,e.subject,left(coalesce(nullif(e.text_body,''),regexp_replace(coalesce(e.html,''),'<[^>]*>',' ','g')),700) body,e.status,e.created_at from emails e join users u on u.id=e.user_id where e.direction='out' and not u.is_admin and e.created_at>now()-make_interval(hours=>$1) order by e.created_at desc limit $2",[h,limit])
 }
 r.get('/audit/summary',w(async(req,res)=>{
  const h=hrs(req);
  const [t]=await q("select count(*)::int emails,count(distinct e.user_id)::int accounts,count(*) filter(where e.status='bounced')::int bounced,count(*) filter(where e.status='complained')::int complained from emails e join users u on u.id=e.user_id where e.direction='out' and not u.is_admin and e.created_at>now()-make_interval(hours=>$1)",[h]);
  const top=await q("select u.id,u.email,u.plan,u.status,count(*)::int sent,count(*) filter(where e.status='bounced')::int bounced,count(*) filter(where e.status='complained')::int complained from emails e join users u on u.id=e.user_id where e.direction='out' and not u.is_admin and e.created_at>now()-make_interval(hours=>$1) group by u.id order by count(*) desc limit 8",[h]);
  const runs=await q("select a.id,a.window_hours,a.accounts,a.frozen,a.blocked,a.watched,a.skipped,a.created_at,(select email from users where id=a.admin_id) admin from audit_runs a order by a.id desc limit 30");
  res.set('Cache-Control','no-store');res.json({hours:h,hours_list:HOURS,totals:t,top,runs})}));
 r.get('/audit/export',w(async(req,res)=>{
  const h=hrs(req);
  const rows=await windowRows(h,20000);
  const by=new Map();
  rows.forEach(m=>{let a=by.get(m.user_id);if(!a){a={account_id:m.user_id,sent:0,statuses:{},messages:[],seen:new Map(),rcpt:new Set(),rdom:new Map()};by.set(m.user_id,a)}
   a.sent++;a.statuses[m.status]=(a.statuses[m.status]||0)+1;
   const to=addrs(m.to_addrs);to.forEach(x=>{a.rcpt.add(x.toLowerCase());const dm=x.slice(x.lastIndexOf('@')+1).toLowerCase();a.rdom.set(dm,(a.rdom.get(dm)||0)+1)});
   const body=clean(m.body,500),key=clean(m.subject,200)+'|'+body.slice(0,120);
   const prev=a.seen.get(key);
   if(prev){prev.copies++;return}
   if(a.messages.length>=25)return;
   const o={id:m.id,at:m.created_at,from:m.from_addr,to_count:to.length,to_sample:to.slice(0,2).map(mask),subject:clean(m.subject,200),text:body,status:m.status,copies:1};
   a.seen.set(key,o);a.messages.push(o)});
  const ids=[...by.keys()];
  const info=ids.length?await q("select u.id,u.email,u.plan,u.status,extract(day from now()-u.created_at)::int age_days,(select coalesce(json_agg(d.name),'[]'::json) from domains d where d.user_id=u.id and d.status='verified') domains,(select count(*)::int from risk_flags f where f.user_id=u.id) flags from users u where u.id=any($1::uuid[])",[ids]):[];
  const im=new Map(info.map(x=>[x.id,x]));
  const accounts=[...by.values()].sort((a,b)=>b.sent-a.sent).map(a=>{const i=im.get(a.account_id)||{};
   return {account_id:a.account_id,email:i.email,plan:i.plan,status:i.status,age_days:i.age_days,verified_domains:i.domains||[],earlier_flags:i.flags||0,sent:a.sent,statuses:a.statuses,unique_recipients:a.rcpt.size,top_recipient_domains:[...a.rdom.entries()].sort((x,y)=>y[1]-x[1]).slice(0,5).map(x=>({domain:x[0],n:x[1]})),messages:a.messages}});
  const out={format:'geserd-audit/1',generated_at:new Date().toISOString(),window_hours:h,emails:rows.length,accounts_count:accounts.length,note:'Recipient addresses are masked. Message text is cut to 500 characters. Identical messages are merged, see copies.',reply_format:'{"format":"geserd-audit-verdict/1","verdicts":[{"account_id":"uuid from this file","action":"watch|freeze|block","severity":0-100,"category":"phishing|fraud|spam|malware|illegal|harassment|other","reason":"what exactly is wrong","evidence":["message ids"]}]}',accounts};
  res.set('Content-Type','application/json; charset=utf-8');
  res.set('Content-Disposition','attachment; filename="geserd-audit-'+h+'h-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.json"');
  res.send(JSON.stringify(out,null,1))}));
 function parse(text){
  let s=String(text||'').trim();
  s=s.replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'').trim();
  const tryp=x=>{try{return JSON.parse(x)}catch(e){return undefined}};
  let j=tryp(s);
  if(j===undefined){const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>-1&&b>a)j=tryp(s.slice(a,b+1))}
  if(j===undefined){const a=s.indexOf('['),b=s.lastIndexOf(']');if(a>-1&&b>a)j=tryp(s.slice(a,b+1))}
  if(j===undefined)return null;
  if(Array.isArray(j))return j;
  if(j&&Array.isArray(j.verdicts))return j.verdicts;
  return null}
 async function resolve(list){
  const out=[];
  const ids=[],mails=[];
  list.forEach(v=>{if(v&&ID.test(String(v.account_id||'')))ids.push(String(v.account_id).toLowerCase());else if(v&&v.email)mails.push(String(v.email).toLowerCase())});
  const us=(ids.length||mails.length)?await q('select id,email,plan,status,is_admin from users where id=any($1::uuid[]) or lower(email)=any($2::text[])',[ids,mails]):[];
  const byId=new Map(us.map(u=>[u.id,u])),byMail=new Map(us.map(u=>[u.email.toLowerCase(),u]));
  const seen=new Set();
  list.slice(0,500).forEach(v=>{
   const it={ok:false};
   if(!v||typeof v!=='object'){it.error='invalid';out.push(it);return}
   const u=ID.test(String(v.account_id||''))?byId.get(String(v.account_id).toLowerCase()):byMail.get(String(v.email||'').toLowerCase());
   const action=String(v.action||'').toLowerCase();
   let sev=parseInt(v.severity,10);if(!(sev>=0))sev=50;sev=Math.min(100,sev);
   const cat=CATS.includes(String(v.category||'').toLowerCase())?String(v.category).toLowerCase():'other';
   const reason=clean(v.reason,300);
   Object.assign(it,{account_id:u?u.id:null,email:u?u.email:clean(v.email||v.account_id,120),plan:u&&u.plan,status:u&&u.status,action,severity:sev,category:cat,reason,evidence:Array.isArray(v.evidence)?v.evidence.slice(0,10).map(x=>clean(x,60)):[]});
   if(!u){it.error='unknown_account';out.push(it);return}
   if(seen.has(u.id)){it.error='duplicate';out.push(it);return}seen.add(u.id);
   if(u.is_admin){it.error='protected';out.push(it);return}
   if(!ACTS.includes(action)){it.error='bad_action';out.push(it);return}
   if(reason.length<3){it.error='no_reason';out.push(it);return}
   let eff=action;
   if(eff==='block'&&sev<70){eff='freeze';it.note='downgraded'}
   if(eff==='freeze'&&u.status==='blocked'){it.error='already';out.push(it);return}
   if(eff==='freeze'&&u.status==='frozen'){it.error='already';out.push(it);return}
   if(eff==='block'&&u.status==='blocked'){it.error='already';out.push(it);return}
   it.effective=eff;it.ok=true;out.push(it)});
  return out}
 r.post('/audit/preview',w(async(req,res)=>{
  const list=parse((req.body||{}).text);
  if(!list)return res.status(400).json({error:'invalid_json'});
  res.json({items:await resolve(list)})}));
 r.post('/audit/apply',w(async(req,res)=>{
  const b=req.body||{};
  const list=Array.isArray(b.verdicts)?b.verdicts:null;
  if(!list||!list.length)return res.status(400).json({error:'nothing'});
  const items=(await resolve(list)).filter(x=>x.ok);
  let fr=0,bl=0,wa=0;
  for(const it of items){
   const [u]=await q('select id,email,lang,status,status_reason,is_admin from users where id=$1',[it.account_id]);
   if(!u||u.is_admin)continue;
   const reason=('audit:'+it.category+': '+it.reason).slice(0,300);
   if(it.effective==='watch'){
    const [ex]=await q("select id from risk_flags where user_id=$1 and kind='content_review' and status='open'",[u.id]);
    if(!ex)await q("insert into risk_flags(user_id,kind,score,details) values($1,'content_review',$2,$3)",[u.id,it.severity,JSON.stringify({audit_reason:it.reason,category:it.category,evidence:it.evidence})]);
    await act(req.user.id,u.id,'audit_watch',{reason:it.reason,category:it.category,severity:it.severity});wa++;continue}
   await setStatus(req.user.id,u,it.effective==='block'?'blocked':'frozen',reason);
   await act(req.user.id,u.id,'audit_'+it.effective,{reason:it.reason,category:it.category,severity:it.severity,evidence:it.evidence});
   if(it.effective==='block')bl++;else fr++}
  const skipped=list.length-items.length;
  await q('insert into audit_runs(admin_id,window_hours,accounts,frozen,blocked,watched,skipped) values($1,$2,$3,$4,$5,$6,$7)',[req.user.id,HOURS.includes(+b.hours)?+b.hours:null,items.length,fr,bl,wa,skipped]);
  res.json({applied:items.length,frozen:fr,blocked:bl,watched:wa,skipped})}));
};
