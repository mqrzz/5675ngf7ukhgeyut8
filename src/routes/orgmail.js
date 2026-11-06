const r=require('express').Router();
const {q}=require('../db');const {w}=require('../auth');const {transport}=require('../mailer');const OM=require('../orgmail');
const ID=/^[0-9a-f-]{36}$/i;
const FULL=['owner','director'];
const KINDS=['general','support','government','legal','press','security','billing','partnerships','advertising','careers','abuse','custom'];
const canBox=async(req,id)=>{if(!ID.test(id))return null;const [b]=await q('select * from org_mailboxes where id=$1',[id]);if(!b)return null;if(FULL.includes(req.staff.role)||(b.staff_ids||[]).includes(req.staff.id))return b;return false};
r.get('/boxes',w(async(req,res)=>{
 const all=FULL.includes(req.staff.role);
 const rows=await q("select b.id,b.address,b.title,b.kind,b.staff_ids,b.show_public,(select count(*)::int from org_messages m where m.mailbox_id=b.id and m.direction='in' and m.read_at is null) unread,(select count(*)::int from org_messages m where m.mailbox_id=b.id and m.direction='in') total from org_mailboxes b "+(all?'':'where $1=any(b.staff_ids) ')+"order by b.created_at",all?[]:[req.staff.id]);
 const staff=all?await q('select id,email,name,staff_role from users where is_admin order by created_at'):[];
 res.json({items:rows,can_manage:all,kinds:KINDS,domain:OM.BASE,staff:staff.map(x=>({id:x.id,email:x.email,name:x.name,role:x.staff_role}))})}));
const validIds=async ids=>{const a=(Array.isArray(ids)?ids:[]).filter(x=>ID.test(String(x)));if(!a.length)return[];const rows=await q('select id from users where is_admin and id=any($1::uuid[])',[a]);return rows.map(x=>x.id)};
r.post('/boxes',w(async(req,res)=>{
 if(!FULL.includes(req.staff.role))return res.status(403).json({error:'forbidden_role'});
 const b=req.body||{},local=String(b.local||'').trim().toLowerCase(),title=String(b.title||'').trim().slice(0,80),kind=KINDS.includes(b.kind)?b.kind:'general';
 if(!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(local))return res.status(400).json({error:'invalid_address'});
 if(!title)return res.status(400).json({error:'invalid_title'});
 const addr=local+'@'+OM.BASE,ids=await validIds(b.staff_ids);
 const [x]=await q('insert into org_mailboxes(address,title,kind,staff_ids,show_public) values($1,$2,$3,$4,$5) on conflict do nothing returning id',[addr,title,kind,ids,!!b.show_public]);
 if(!x)return res.status(409).json({error:'exists'});
 res.json({id:x.id,address:addr})}));
r.patch('/boxes/:id',w(async(req,res)=>{
 if(!FULL.includes(req.staff.role))return res.status(403).json({error:'forbidden_role'});
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const b=req.body||{},sets=[],v=[req.params.id];
 if(b.title!==undefined){v.push(String(b.title).trim().slice(0,80));sets.push('title=$'+v.length)}
 if(b.kind!==undefined&&KINDS.includes(b.kind)){v.push(b.kind);sets.push('kind=$'+v.length)}
 if(b.staff_ids!==undefined){v.push(await validIds(b.staff_ids));sets.push('staff_ids=$'+v.length)}
 if(b.show_public!==undefined){v.push(!!b.show_public);sets.push('show_public=$'+v.length)}
 if(!sets.length)return res.json({ok:true});
 await q('update org_mailboxes set '+sets.join(',')+' where id=$1',v);res.json({ok:true})}));
r.delete('/boxes/:id',w(async(req,res)=>{
 if(!FULL.includes(req.staff.role))return res.status(403).json({error:'forbidden_role'});
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 await q('delete from org_mailboxes where id=$1',[req.params.id]);res.json({ok:true})}));
r.get('/all',w(async(req,res)=>{
 const all=FULL.includes(req.staff.role),dir=req.query.folder==='out'?'out':'in',off=Math.max(0,parseInt(req.query.offset,10)||0);
 const rows=await q("select m.id,m.mailbox_id,b.title box_title,b.address box_address,m.from_addr,m.to_addrs,m.subject,left(coalesce(m.text_body,''),160) preview,m.read_at,m.created_at,(select count(*)::int from org_attachments a where a.message_id=m.id) atts from org_messages m join org_mailboxes b on b.id=m.mailbox_id where m.direction=$1 "+(all?'':'and $3=any(b.staff_ids) ')+"order by m.created_at desc limit 50 offset $2",all?[dir,off]:[dir,off,req.staff.id]);
 res.json({items:rows})}));
r.get('/boxes/:id/messages',w(async(req,res)=>{
 const b=await canBox(req,req.params.id);if(b===null)return res.status(404).json({error:'not_found'});if(b===false)return res.status(403).json({error:'forbidden_role'});
 const dir=req.query.folder==='out'?'out':'in',off=Math.max(0,parseInt(req.query.offset,10)||0);
 const rows=await q("select m.id,m.from_addr,m.to_addrs,m.subject,left(coalesce(m.text_body,''),160) preview,m.read_at,m.created_at,(select count(*)::int from org_attachments a where a.message_id=m.id) atts from org_messages m where m.mailbox_id=$1 and m.direction=$2 order by m.created_at desc limit 50 offset $3",[b.id,dir,off]);
 res.json({items:rows,mailbox:{id:b.id,address:b.address,title:b.title}})}));
r.get('/messages/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [m]=await q('select * from org_messages where id=$1',[req.params.id]);if(!m)return res.status(404).json({error:'not_found'});
 const b=await canBox(req,m.mailbox_id);if(!b)return res.status(403).json({error:'forbidden_role'});
 if(!m.read_at&&m.direction==='in')await q('update org_messages set read_at=now() where id=$1',[m.id]);
 const atts=await q('select id,filename,content_type,size from org_attachments where message_id=$1 order by filename',[m.id]);
 res.json({id:m.id,direction:m.direction,from:m.from_addr,to:m.to_addrs,subject:m.subject,text:m.text_body,created_at:m.created_at,message_id:m.message_id,mailbox:{id:b.id,address:b.address,title:b.title},attachments:atts})}));
r.get('/attachments/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).end();
 const [a]=await q('select a.filename,a.content_type,a.data,m.mailbox_id from org_attachments a join org_messages m on m.id=a.message_id where a.id=$1',[req.params.id]);if(!a)return res.status(404).end();
 const b=await canBox(req,a.mailbox_id);if(!b)return res.status(403).end();
 res.set({'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.filename||'file'),'X-Content-Type-Options':'nosniff','Cache-Control':'private,no-store'});res.send(a.data)}));
r.delete('/messages/:id',w(async(req,res)=>{
 if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [m]=await q('select mailbox_id from org_messages where id=$1',[req.params.id]);if(!m)return res.status(404).json({error:'not_found'});
 const b=await canBox(req,m.mailbox_id);if(!b)return res.status(403).json({error:'forbidden_role'});
 await q('delete from org_messages where id=$1',[req.params.id]);res.json({ok:true})}));
r.post('/boxes/:id/send',w(async(req,res)=>{
 const b=await canBox(req,req.params.id);if(b===null)return res.status(404).json({error:'not_found'});if(b===false)return res.status(403).json({error:'forbidden_role'});
 const x=req.body||{},to=String(x.to||'').split(/[,;\s]+/).filter(Boolean).slice(0,10);
 if(!to.length||to.some(a=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)))return res.status(400).json({error:'invalid_to'});
 const subject=String(x.subject||'').trim().slice(0,300),text=String(x.text||'').slice(0,200000);
 if(!subject&&!text)return res.status(400).json({error:'empty'});
 let reply=null;if(x.reply_to_id&&ID.test(String(x.reply_to_id))){const [o]=await q('select message_id,mailbox_id from org_messages where id=$1',[x.reply_to_id]);if(o&&o.mailbox_id===b.id)reply=o.message_id}
 const atts=[];let total=0;
 for(const a of (Array.isArray(x.attachments)?x.attachments:[]).slice(0,10)){
  const buf=Buffer.from(String(a.data||''),'base64');total+=buf.length;
  if(total>OM.MAX_ATT)return res.status(413).json({error:'too_large'});
  if(!(await OM.allowed(a.filename,buf)))return res.status(400).json({error:'attachment_blocked',filename:a.filename});
  atts.push({filename:String(a.filename||'file').slice(0,200),content:buf,contentType:String(a.content_type||'application/octet-stream')})}
 const mid='<'+require('crypto').randomUUID()+'@'+OM.BASE+'>';
 try{await transport.sendMail({from:{name:b.title,address:b.address},to,subject,text,attachments:atts,messageId:mid,inReplyTo:reply||undefined,references:reply||undefined,replyTo:b.address})}catch(e){console.error('orgmail send',e.message);return res.status(502).json({error:'send_failed',detail:String(e.message||'').slice(0,240)})}
 const s=await OM.save(b,{direction:'out',from:b.address,to:to.join(', '),subject,text,message_id:mid,in_reply_to:reply,sent_by:req.staff.id},atts.map(a=>({filename:a.filename,content:a.content,contentType:a.contentType})));
 res.json({id:s.id})}));
module.exports=r;
