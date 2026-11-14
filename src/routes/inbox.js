const r=require('express').Router();
const c=require('crypto');
const {q}=require('../db');const {w,need}=require('../auth');
const PLANS=require('../plans');const SH=require('../shared');
const {send}=require('../send');
const WH=require('../webhooks');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACT=['store','forward','webhook','autoreply','drop'];
r.use(need);
async function ws(req){
 const x=req.get('x-workspace')||req.query.ws;
 if(x&&ID.test(x)&&x!==req.user.id){const[m]=await q('select 1 from team_members where owner_id=$1 and user_id=$2',[x,req.user.id]);if(m)return x}
 return req.user.id}
const clean=(s,n)=>String(s==null?'':s).replace(/\u0000/g,'').trim().slice(0,n);
r.get('/summary',w(async(req,res)=>{
 const o=await ws(req);
 const[t]=await q("select count(*) filter(where direction='in' and read_at is null)::int unread,count(distinct thread_id) filter(where state='open')::int open,count(distinct thread_id) filter(where state='closed')::int closed from emails where user_id=$1 and thread_id is not null and (direction='in' or thread_id in(select thread_id from emails where user_id=$1 and direction='in'))",[o]);
 const doms=await q("select lower(split_part(x,'@',2)) d,count(distinct e.thread_id)::int n,count(*) filter(where e.read_at is null)::int unread from emails e,jsonb_array_elements_text(e.to_addrs) x where e.user_id=$1 and e.direction='in' and e.thread_id is not null group by 1 order by 2 desc",[o]);
 const team=await q("select u.id,u.name,u.email from users u where u.id=$1 union select u.id,u.name,u.email from team_members m join users u on u.id=m.user_id where m.owner_id=$1",[o]);
 const mine=await q('select name from domains where user_id=$1 and status=\'verified\' and receiving_ok order by name',[o]);
 const hs=await q('select handle from handles where user_id=$1',[o]);
 res.set('Cache-Control','no-store');
 res.json({...t,domains:doms,team,receiving:mine.map(x=>x.name).concat(hs.length?[SH.SHARED]:[])})}));
r.get('/threads',w(async(req,res)=>{
 const o=await ws(req),a=[o];let where="e.user_id=$1 and e.thread_id is not null";
 const st=req.query.state;
 if(req.query.domain){a.push('%@'+String(req.query.domain).toLowerCase().replace(/[\\%_]/g,m=>'\\'+m));where+=" and e.thread_id in(select thread_id from emails where user_id=$1 and direction='in' and to_addrs::text ilike $"+a.length+")"}
 if(req.query.q){a.push('%'+clean(req.query.q,100).replace(/[\\%_]/g,m=>'\\'+m)+'%');where+=" and (e.subject ilike $"+a.length+" or e.from_addr ilike $"+a.length+" or e.text_body ilike $"+a.length+")"}
 const have=[];
 if(st==='open'||st==='closed'){a.push(st);have.push("(array_agg(e.state order by e.created_at desc))[1]=$"+a.length)}
 if(req.query.unread==='1')have.push("count(*) filter(where e.direction='in' and e.read_at is null)>0");
 if(req.query.assignee==='me'){a.push(req.user.id);have.push("(array_agg(e.assignee order by e.created_at desc))[1]=$"+a.length)}
 else if(req.query.assignee==='none')have.push("(array_agg(e.assignee order by e.created_at desc))[1] is null");
 if(req.query.before){const t=new Date(req.query.before);if(!isNaN(t)){a.push(t.toISOString());have.push("max(e.created_at)<$"+a.length)}}
 have.unshift("bool_or(e.direction='in')");
 const rows=await q("select e.thread_id id,(array_agg(e.subject order by e.created_at))[1] subject,max(e.created_at) last_at,count(*)::int n,count(*) filter(where e.direction='in' and e.read_at is null)::int unread,(array_agg(e.state order by e.created_at desc))[1] state,(array_agg(e.assignee order by e.created_at desc))[1] assignee,(array_agg(e.from_addr order by e.created_at desc))[1] last_from,(array_agg(e.direction order by e.created_at desc))[1] last_dir,left((array_agg(coalesce(e.text_body,'') order by e.created_at desc))[1],160) snippet,(array_agg(e.to_addrs order by e.created_at) filter(where e.direction='in'))[1] first_to,(array_agg(e.from_addr order by e.created_at) filter(where e.direction='in'))[1] first_from,bool_or(jsonb_array_length(coalesce(e.attachments,'[]'::jsonb))>0) has_files from emails e where "+where+" group by e.thread_id having "+have.join(' and ')+" order by max(e.created_at) desc limit 51",a);
 const names=await q('select id,coalesce(nullif(name,\'\'),email) n from users where id=any($1::uuid[])',[rows.map(x=>x.assignee).filter(Boolean)]);
 const nm=new Map(names.map(x=>[x.id,x.n]));
 res.set('Cache-Control','no-store');
 res.json({data:rows.slice(0,50).map(x=>({...x,assignee_name:x.assignee?nm.get(x.assignee)||null:null,snippet:String(x.snippet||'').replace(/\s+/g,' ').trim()})),next:rows.length>50?rows[49].last_at:null})}));
r.get('/threads/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const o=await ws(req);
 const ms=await q("select id,direction,from_addr,to_addrs,subject,html,text_body,status,message_id,headers,attachments,created_at,read_at,state,assignee from emails where user_id=$1 and thread_id=$2 order by created_at,id",[o,req.params.id]);
 if(!ms.length)return res.status(404).json({error:'not_found'});
 const files=await q('select id,email_id,filename,content_type,size from email_files where email_id=any($1::uuid[]) order by created_at',[ms.map(x=>x.id)]);
 await q("update emails set read_at=now() where user_id=$1 and thread_id=$2 and direction='in' and read_at is null",[o,req.params.id]);
 const last=ms[ms.length-1];
 res.set('Cache-Control','no-store');
 res.json({id:req.params.id,subject:ms[0].subject,state:last.state,assignee:last.assignee,messages:ms.map(x=>({id:x.id,direction:x.direction,from:x.from_addr,to:x.to_addrs,subject:x.subject,html:x.html,text:x.text_body,status:x.status,created_at:x.created_at,files:files.filter(f=>f.email_id===x.id).map(f=>({id:f.id,filename:f.filename,content_type:f.content_type,size:f.size}))}))})}));
r.patch('/threads/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const o=await ws(req),b=req.body||{};
 if(b.state!==undefined){if(b.state!=='open'&&b.state!=='closed')return res.status(400).json({error:'invalid_state'});await q('update emails set state=$3 where user_id=$1 and thread_id=$2',[o,req.params.id,b.state])}
 if(b.assignee!==undefined){
  if(b.assignee===null||b.assignee==='')await q('update emails set assignee=null where user_id=$1 and thread_id=$2',[o,req.params.id]);
  else{if(!ID.test(String(b.assignee)))return res.status(400).json({error:'invalid_assignee'});
   const[ok]=await q('select 1 from users where id=$1 and (id=$2 or id in(select user_id from team_members where owner_id=$2))',[b.assignee,o]);
   if(!ok)return res.status(400).json({error:'invalid_assignee'});
   await q('update emails set assignee=$3 where user_id=$1 and thread_id=$2',[o,req.params.id,b.assignee])}}
 if(b.unread===true)await q("update emails set read_at=null where id=(select id from emails where user_id=$1 and thread_id=$2 and direction='in' order by created_at desc limit 1)",[o,req.params.id]);
 res.json({ok:true})}));
r.post('/threads/:id/reply',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const o=await ws(req);
 if(o!==req.user.id)return res.status(403).json({error:'forbidden'});
 const b=req.body||{};
 const ms=await q("select direction,from_addr,to_addrs,subject,message_id,headers,created_at from emails where user_id=$1 and thread_id=$2 order by created_at,id",[o,req.params.id]);
 if(!ms.length)return res.status(404).json({error:'not_found'});
 const lastIn=[...ms].reverse().find(x=>x.direction==='in');
 if(!lastIn)return res.status(400).json({error:'nothing_to_reply_to'});
 const text=clean(b.text,200000);if(!text)return res.status(400).json({error:'empty_body'});
 const rp=lastIn.headers&&lastIn.headers['reply-to'];
 const to=clean(b.to,320)||(rp?String(rp).replace(/^.*<|>.*$/g,'').trim():lastIn.from_addr);
 const owned=await q("select name from domains where user_id=$1 and status='verified' and sending_ok",[o]);
 const hs=await q('select handle from handles where user_id=$1',[o]);
 const mine=new Set(owned.map(x=>x.name).concat(hs.length?[SH.SHARED]:[]));
 let from=clean(b.from,320);
 if(!from){const cand=(lastIn.to_addrs||[]).find(a=>mine.has(String(a).split('@')[1]));from=cand||(lastIn.to_addrs||[])[0]}
 const base=String(ms[0].subject||'').replace(/^((re|aw|sv|fw|fwd)\s*:\s*)+/i,'');
 const ids=ms.map(x=>x.message_id).filter(Boolean);
 const last=ms[ms.length-1];
 const body={from,to:[to],subject:/^re\s*:/i.test(lastIn.subject||'')?lastIn.subject:'Re: '+base,text,attachments:Array.isArray(b.attachments)?b.attachments:undefined,headers:{'in-reply-to':last.message_id||lastIn.message_id||'',references:ids.slice(-10).join(' ')}};
 if(!body.headers['in-reply-to'])delete body.headers['in-reply-to'];
 if(!body.headers.references)delete body.headers.references;
 try{const out=await send(o,body,null);
  await q("update emails set state='open' where user_id=$1 and thread_id=$2",[o,req.params.id]);
  res.json(out)}
 catch(e){if(e&&e.code)return res.status(e.code==='domain_not_verified'?400:(e.code==='rate_limited'?429:400)).json({error:e.code,...e.extra});throw e}}));
r.get('/files/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const o=await ws(req);
 const[f]=await q('select f.filename,f.content_type,f.data from email_files f join emails e on e.id=f.email_id where f.id=$1 and e.user_id=$2',[req.params.id,o]);
 if(!f)return res.status(404).json({error:'not_found'});
 const name=String(f.filename||'file').replace(/[^\w.\- ]+/g,'_').slice(0,120)||'file';
 res.set({'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+name+'"; filename*=UTF-8\'\''+encodeURIComponent(f.filename||name),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});
 res.send(f.data)}));
async function ruleDomains(uid){
 const owned=await q("select name from domains where user_id=$1 and status='verified'",[uid]);
 const hs=await q('select 1 from handles where user_id=$1 limit 1',[uid]);
 return owned.map(x=>x.name).concat(hs.length?[SH.SHARED]:[])}
const view=x=>({id:x.id,domain:x.domain,match:x.match,action:x.action,target:x.target,reply_subject:x.reply_subject,reply_body:x.reply_body,enabled:x.enabled,position:x.position,hits:x.hits,last_hit_at:x.last_hit_at,secret:x.action==='webhook'?x.secret:undefined});
r.get('/rules',w(async(req,res)=>{
 const rows=await q('select * from inbound_rules where user_id=$1 order by position,created_at',[req.user.id]);
 const [{plan}]=await q('select eff_plan(plan,tariff) plan from users where id=$1',[req.user.id]);
 res.json({items:rows.map(view),limit:(PLANS[plan]||PLANS.free).routes,domains:await ruleDomains(req.user.id)})}));
async function checked(req,cur){
 const b=req.body||{},o={};
 const domains=await ruleDomains(req.user.id);
 o.domain=cur?cur.domain:String(b.domain||'').toLowerCase().trim();
 if(!domains.includes(o.domain))throw Object.assign(new Error('x'),{status:400,code:'invalid_domain'});
 o.match=cur&&b.match===undefined?cur.match:String(b.match||'').toLowerCase().trim();
 if(!/^[a-z0-9._+\-*?]{1,64}$/.test(o.match))throw Object.assign(new Error('x'),{status:400,code:'invalid_match'});
 o.action=b.action===undefined&&cur?cur.action:String(b.action||'');
 if(!ACT.includes(o.action))throw Object.assign(new Error('x'),{status:400,code:'invalid_action'});
 o.target=b.target===undefined&&cur?cur.target:clean(b.target,1000);
 if(o.action==='forward'){const l=String(o.target||'').split(/[\s,;]+/).filter(Boolean);if(!l.length||l.length>5||l.some(x=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))throw Object.assign(new Error('x'),{status:400,code:'invalid_target'});o.target=l.join(', ')}
 else if(o.action==='webhook'){if(!await WH.safeTarget(o.target))throw Object.assign(new Error('x'),{status:400,code:'invalid_target'})}
 else o.target=null;
 o.reply_subject=b.reply_subject===undefined&&cur?cur.reply_subject:clean(b.reply_subject,200)||null;
 o.reply_body=b.reply_body===undefined&&cur?cur.reply_body:clean(b.reply_body,5000)||null;
 if(o.action==='autoreply'&&!o.reply_body)throw Object.assign(new Error('x'),{status:400,code:'invalid_reply'});
 o.enabled=b.enabled===undefined?(cur?cur.enabled:true):!!b.enabled;
 return o}
function bad(res,e){if(e&&e.code&&e.status)return res.status(e.status).json({error:e.code});throw e}
r.post('/rules',w(async(req,res)=>{
 const[{plan}]=await q('select eff_plan(plan,tariff) plan from users where id=$1',[req.user.id]);
 const n=(await q('select count(*)::int n from inbound_rules where user_id=$1',[req.user.id]))[0].n;
 if(n>=(PLANS[plan]||PLANS.free).routes)return res.status(403).json({error:'plan_limit'});
 try{const o=await checked(req,null);
  const pos=(await q('select coalesce(max(position),0)+1 p from inbound_rules where user_id=$1',[req.user.id]))[0].p;
  const[x]=await q('insert into inbound_rules(user_id,domain,match,action,target,secret,reply_subject,reply_body,enabled,position) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[req.user.id,o.domain,o.match,o.action,o.target,o.action==='webhook'?'whsec_'+c.randomBytes(24).toString('hex'):null,o.reply_subject,o.reply_body,o.enabled,pos]);
  res.status(201).json(view(x))}catch(e){bad(res,e)}}));
r.patch('/rules/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const[cur]=await q('select * from inbound_rules where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!cur)return res.status(404).json({error:'not_found'});
 try{const o=await checked(req,cur);
  const sec=o.action==='webhook'?(cur.secret||'whsec_'+c.randomBytes(24).toString('hex')):null;
  const[x]=await q('update inbound_rules set match=$2,action=$3,target=$4,secret=$5,reply_subject=$6,reply_body=$7,enabled=$8 where id=$1 returning *',[cur.id,o.match,o.action,o.target,sec,o.reply_subject,o.reply_body,o.enabled]);
  res.json(view(x))}catch(e){bad(res,e)}}));
r.post('/rules/:id/move',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const dir=(req.body||{}).dir==='up'?-1:1;
 const rows=await q('select id from inbound_rules where user_id=$1 order by position,created_at',[req.user.id]);
 const i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'not_found'});
 const j=i+dir;if(j>=0&&j<rows.length){const t=rows[i];rows[i]=rows[j];rows[j]=t}
 for(let k=0;k<rows.length;k++)await q('update inbound_rules set position=$2 where id=$1',[rows[k].id,k+1]);
 res.json({ok:true})}));
r.delete('/rules/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 await q('delete from inbound_rules where id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
module.exports=r;
