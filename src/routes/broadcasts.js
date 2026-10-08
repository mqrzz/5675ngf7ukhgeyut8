const r=require('express').Router();const {q}=require('../db');const {w,need}=require('../auth');
const {send,parseAddr,status}=require('../send');const B=require('../broadcast');
const ADDR=/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const UUID=/^[0-9a-f-]{36}$/i;const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const clip=(v,n)=>v==null?null:String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,n);
const line=(v,n)=>{v=clip(v,n);return v==null?null:v.replace(/[\r\n]+/g,' ').trim()};
const COLS='id,audience_id,audience_name,name,from_addr,reply_to,subject,template_id,status,error,total,sent,failed,skipped,scheduled_at,resume_at,started_at,finished_at,created_at,updated_at';
r.use(need);
async function mine(uid,id){if(!UUID.test(String(id)))return null;const[b]=await q('select * from broadcasts where id=$1 and user_id=$2',[id,uid]);return b||null}
function view(b){const o={};for(const k of COLS.split(','))o[k]=b[k];o.has_html=!!b.html;o.has_text=!!b.text_body;return o}
async function fields(uid,body,cur){
 const o={},b=body||{},err=c=>Object.assign(new Error(c),{code:c});
 if('name'in b){o.name=line(b.name,120);if(!o.name)throw err('invalid_name')}
 if('audience_id'in b){if(b.audience_id==null||b.audience_id==='')o.audience_id=null;else{if(!UUID.test(String(b.audience_id)))throw err('audience_not_found');const[a]=await q('select id,name from audiences where id=$1 and user_id=$2',[b.audience_id,uid]);if(!a)throw err('audience_not_found');o.audience_id=a.id;o.audience_name=a.name}}
 if('from'in b){const f=line(b.from,300);if(f){const p=parseAddr(f);if(!ADDR.test(p.email))throw err('invalid_from')}o.from_addr=f||null}
 if('reply_to'in b){const f=line(b.reply_to,254);if(f&&!ADDR.test(parseAddr(f).email))throw err('invalid_reply_to');o.reply_to=f||null}
 if('subject'in b)o.subject=line(b.subject,300);
 if('html'in b)o.html=clip(b.html,1000000)||null;
 if('text'in b)o.text_body=clip(b.text,200000)||null;
 if('template_id'in b){
  if(b.template_id==null||b.template_id==='')o.template_id=null;
  else{if(!UUID.test(String(b.template_id)))throw err('template_not_found');const[t]=await q('select id,subject,html,text_body from templates where id=$1 and user_id=$2',[b.template_id,uid]);if(!t)throw err('template_not_found');
   o.template_id=t.id;if(!('subject'in b)&&!(cur&&cur.subject))o.subject=t.subject;if(!('html'in b)){o.html=t.html}if(!('text'in b)){o.text_body=t.text_body}}}
 return o}
async function fromReady(uid,from){
 const e=parseAddr(from).email,dom=e.split('@')[1]||'';
 const[d]=await q("select 1 from domains where user_id=$1 and name=$2 and status='verified' and sending_ok",[uid,dom]);if(d)return true;
 if(dom.endsWith('.'+BASE)){const slug=dom.slice(0,-(BASE.length+1));if(slug&&!slug.includes('.'))return(await q('select 1 from subdomains where slug=$1 and user_id=$2',[slug,uid])).length>0}
 return false}
function fail(res,e){const c=e&&e.code;if(c&&/^(invalid_|audience_not_found|template_not_found)/.test(c))return res.status(c.endsWith('not_found')?404:400).json({error:c});throw e}
r.get('/',w(async(req,res)=>{
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25)),off=Math.max(0,parseInt(req.query.offset,10)||0);
 const args=[req.user.id];let where='user_id=$1';if(req.query.status){args.push(String(req.query.status));where+=' and status=$'+args.length}
 const[t]=await q('select count(*)::int n from broadcasts where '+where,args);
 const rows=await q('select '+COLS+' from broadcasts where '+where+' order by created_at desc limit '+lim+' offset '+off,args);
 res.json({data:rows,total:t.n,limit:lim,offset:off})
}));
r.post('/',w(async(req,res)=>{
 try{
  const o=await fields(req.user.id,req.body,null);if(!o.name)return res.status(400).json({error:'invalid_name'});
  const k=Object.keys(o),[b]=await q('insert into broadcasts(user_id,'+k.join(',')+') values($1,'+k.map((_,i)=>'$'+(i+2)).join(',')+') returning '+COLS+',html,text_body',[req.user.id,...k.map(x=>o[x])]);
  res.status(201).json(view(b))
 }catch(e){fail(res,e)}
}));
r.get('/:id',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 const errs=await q("select email,error from broadcast_recipients where broadcast_id=$1 and status='failed' order by email limit 20",[b.id]);
 const[p]=await q("select count(*)::int n from broadcast_recipients where broadcast_id=$1 and status='pending'",[b.id]);
 res.json({...view(b),html:b.html,text:b.text_body,pending:p.n,failures:errs})
}));
r.patch('/:id',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 if(b.status!=='draft')return res.status(409).json({error:'not_editable'});
 try{
  const o=await fields(req.user.id,req.body,b),k=Object.keys(o);if(!k.length)return res.status(400).json({error:'nothing_to_update'});
  await q('update broadcasts set '+k.map((x,i)=>x+'=$'+(i+2)).join(',')+',updated_at=now() where id=$1',[b.id,...k.map(x=>o[x])]);
  const n=await mine(req.user.id,b.id);res.json({...view(n),html:n.html,text:n.text_body})
 }catch(e){fail(res,e)}
}));
r.post('/:id/duplicate',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 const[n]=await q("insert into broadcasts(user_id,audience_id,audience_name,name,from_addr,reply_to,subject,template_id,html,text_body) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning "+COLS,[req.user.id,b.audience_id,b.audience_name,(b.name+' (copy)').slice(0,120),b.from_addr,b.reply_to,b.subject,b.template_id,b.html,b.text_body]);
 res.status(201).json(view(n))
}));
r.post('/:id/test',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 const to=String(req.body.to||'').trim().toLowerCase();if(!ADDR.test(to))return res.status(400).json({error:'invalid_to'});
 if(!b.from_addr)return res.status(400).json({error:'from_required'});
 try{
  const p=B.compose({...b,subject:'[Test] '+(b.subject||'')},{email:to,first_name:'Test',last_name:'',contact_id:'00000000-0000-0000-0000-000000000000'},B.pageUrl('test'));
  const out=await send(req.user.id,p,null);res.json({ok:true,id:out.id})
 }catch(e){if(e&&e.code)return res.status(status(e.code)).json({error:e.code,...e.extra});throw e}
}));
r.post('/:id/send',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 if(b.status!=='draft')return res.status(409).json({error:'not_editable'});
 if(!b.audience_id)return res.status(400).json({error:'audience_required'});
 if(!b.from_addr)return res.status(400).json({error:'from_required'});
 if(!String(b.subject||'').trim())return res.status(400).json({error:'subject_required'});
 if(!b.html&&!b.text_body)return res.status(400).json({error:'empty_body'});
 if(!(await fromReady(req.user.id,b.from_addr)))return res.status(403).json({error:'domain_not_verified',domain:parseAddr(b.from_addr).email.split('@')[1]});
 const[n]=await q('select count(*)::int n from contacts where audience_id=$1 and not unsubscribed',[b.audience_id]);
 if(!n.n)return res.status(400).json({error:'audience_empty'});
 let at=null;
 if(req.body.scheduled_at){at=new Date(req.body.scheduled_at);if(isNaN(at)||at.getTime()<Date.now()+60000||at.getTime()>Date.now()+30*864e5)return res.status(400).json({error:'invalid_schedule'})}
 if(at){await q("update broadcasts set status='scheduled',scheduled_at=$2,total=$3,updated_at=now() where id=$1",[b.id,at,n.n])}
 else{await B.start(b)}
 const x=await mine(req.user.id,b.id);res.json(view(x))
}));
r.post('/:id/cancel',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 if(!['scheduled','sending','paused'].includes(b.status))return res.status(409).json({error:'not_cancelable'});
 const rows=await q("update broadcast_recipients set status='skipped',error='canceled' where broadcast_id=$1 and status='pending' returning 1",[b.id]);
 await q("update broadcasts set status='canceled',skipped=skipped+$2,finished_at=now(),updated_at=now() where id=$1",[b.id,rows.length]);
 res.json(view(await mine(req.user.id,b.id)))
}));
r.delete('/:id',w(async(req,res)=>{
 const b=await mine(req.user.id,req.params.id);if(!b)return res.status(404).json({error:'not_found'});
 if(['scheduled','sending'].includes(b.status))return res.status(409).json({error:'cancel_first'});
 await q('delete from broadcasts where id=$1',[b.id]);res.json({ok:true})
}));
module.exports=r;
