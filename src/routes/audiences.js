const r=require('express').Router();const {q}=require('../db');const {w,need}=require('../auth');const PLANS=require('../plans');
const ADDR=/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const UUID=/^[0-9a-f-]{36}$/i;
const clip=(v,n)=>v==null||v===''?null:String(v).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n)||null;
r.use(need);
async function limits(uid){const[u]=await q('select plan from users where id=$1',[uid]);return PLANS[u.plan]||PLANS.free}
async function mine(uid,id){if(!UUID.test(String(id)))return null;const[a]=await q('select * from audiences where id=$1 and user_id=$2',[id,uid]);return a||null}
function csv(text){
 const rows=[];let row=[],cur='',inq=false,sep=null;text=String(text||'').replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/,1)[0]||'';sep=first.includes('\t')?'\t':first.includes(';')&&!first.includes(',')?';':',';
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(inq){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else inq=false}else cur+=ch}
  else if(ch==='"')inq=true;
  else if(ch===sep){row.push(cur);cur=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';if(row.some(x=>x.trim()))rows.push(row);row=[]}
  else cur+=ch}
 row.push(cur);if(row.some(x=>x.trim()))rows.push(row);
 if(!rows.length)return[];
 const head=rows[0].map(x=>x.trim().toLowerCase().replace(/[\s-]+/g,'_'));
 const hasHead=head.includes('email')||head.includes('e_mail')||head.includes('mail');
 const idx={email:0,first_name:1,last_name:2};
 if(hasHead){idx.email=head.findIndex(x=>x==='email'||x==='e_mail'||x==='mail');idx.first_name=head.findIndex(x=>x==='first_name'||x==='firstname'||x==='name');idx.last_name=head.findIndex(x=>x==='last_name'||x==='lastname'||x==='surname')}
 return(hasHead?rows.slice(1):rows).map(x=>({email:x[idx.email],first_name:idx.first_name>-1?x[idx.first_name]:null,last_name:idx.last_name>-1?x[idx.last_name]:null}))
}
r.get('/',w(async(req,res)=>{
 const rows=await q("select a.id,a.name,a.created_at,count(c.id)::int contacts,count(c.id) filter(where c.unsubscribed)::int unsubscribed from audiences a left join contacts c on c.audience_id=a.id where a.user_id=$1 group by a.id order by a.created_at",[req.user.id]);
 const L=await limits(req.user.id);const[t]=await q('select count(*)::int n from contacts where user_id=$1',[req.user.id]);
 res.json({data:rows,limits:{audiences:L.audiences,contacts:L.contacts},used:{audiences:rows.length,contacts:t.n}})
}));
r.post('/',w(async(req,res)=>{
 const name=clip(req.body.name,80);if(!name)return res.status(400).json({error:'invalid_name'});
 const L=await limits(req.user.id);const[n]=await q('select count(*)::int n from audiences where user_id=$1',[req.user.id]);
 if(L.audiences&&n.n>=L.audiences)return res.status(403).json({error:'limit_reached',limit:L.audiences,resource:'audiences'});
 const[a]=await q('insert into audiences(user_id,name) values($1,$2) returning id,name,created_at',[req.user.id,name]);
 res.status(201).json({...a,contacts:0,unsubscribed:0})
}));
r.patch('/:id',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 const name=clip(req.body.name,80);if(!name)return res.status(400).json({error:'invalid_name'});
 await q('update audiences set name=$2 where id=$1',[a.id,name]);await q('update broadcasts set audience_name=$2 where audience_id=$1',[a.id,name]);res.json({ok:true,name})
}));
r.delete('/:id',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 const[b]=await q("select count(*)::int n from broadcasts where audience_id=$1 and status in('scheduled','sending','paused')",[a.id]);
 if(b.n)return res.status(409).json({error:'audience_in_use'});
 await q('update broadcasts set audience_name=$2 where audience_id=$1',[a.id,a.name]);
 await q('delete from audiences where id=$1',[a.id]);res.json({ok:true})
}));
r.get('/:id',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 const[s]=await q("select count(*)::int contacts,count(*) filter(where unsubscribed)::int unsubscribed from contacts where audience_id=$1",[a.id]);
 res.json({id:a.id,name:a.name,created_at:a.created_at,...s})
}));
r.get('/:id/contacts',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25)),off=Math.max(0,parseInt(req.query.offset,10)||0);
 const args=[a.id];let where='audience_id=$1';
 const s=String(req.query.q||'').trim().slice(0,100);if(s){args.push('%'+s.replace(/[\\%_]/g,m=>'\\'+m)+'%');where+=" and (email ilike $"+args.length+" or coalesce(first_name,'') ilike $"+args.length+" or coalesce(last_name,'') ilike $"+args.length+")"}
 if(req.query.status==='subscribed')where+=' and not unsubscribed';if(req.query.status==='unsubscribed')where+=' and unsubscribed';
 const[t]=await q('select count(*)::int n from contacts where '+where,args);
 const rows=await q('select id,email,first_name,last_name,unsubscribed,unsubscribed_at,created_at from contacts where '+where+' order by created_at desc,id limit '+lim+' offset '+off,args);
 res.json({data:rows,total:t.n,limit:lim,offset:off})
}));
r.get('/:id/export',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 const rows=await q('select email,first_name,last_name,unsubscribed,created_at from contacts where audience_id=$1 order by created_at',[a.id]);
 const e=v=>{v=v==null?'':String(v);if(/^[=+\-@]/.test(v))v="'"+v;return/[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
 const out=['email,first_name,last_name,unsubscribed,created_at'].concat(rows.map(x=>[x.email,x.first_name,x.last_name,x.unsubscribed,x.created_at.toISOString()].map(e).join(','))).join('\n')+'\n';
 res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="audience.csv"').send(out)
}));
r.post('/:id/contacts',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a)return res.status(404).json({error:'not_found'});
 let list=[];
 if(typeof req.body.csv==='string')list=csv(req.body.csv.slice(0,2000000));
 else if(Array.isArray(req.body.contacts))list=req.body.contacts;
 else if(req.body.email!=null)list=[req.body];
 else return res.status(400).json({error:'invalid_contacts'});
 if(list.length>5000)return res.status(413).json({error:'too_many_rows',max:5000});
 const L=await limits(req.user.id);const[t]=await q('select count(*)::int n from contacts where user_id=$1',[req.user.id]);
 const seen=new Set(),ok=[];let invalid=0,dup=0;
 for(const x of list){const em=String((x&&x.email)||'').trim().toLowerCase();if(!ADDR.test(em)||em.length>254){invalid++;continue}if(seen.has(em)){dup++;continue}seen.add(em);ok.push({email:em,first_name:clip(x.first_name,80),last_name:clip(x.last_name,80)})}
 if(!ok.length)return res.status(400).json({error:'no_valid_contacts',invalid});
 const have=new Set((await q('select email from contacts where audience_id=$1 and email=any($2)',[a.id,ok.map(x=>x.email)])).map(x=>x.email));
 const fresh=ok.filter(x=>!have.has(x.email));
 if(L.contacts&&t.n+fresh.length>L.contacts)return res.status(403).json({error:'limit_reached',limit:L.contacts,resource:'contacts',used:t.n});
 let added=0;
 for(let i=0;i<fresh.length;i+=500){const ch=fresh.slice(i,i+500);
  const rows=await q("insert into contacts(audience_id,user_id,email,first_name,last_name) select $1,$2,e,f,l from unnest($3::text[],$4::text[],$5::text[]) as t(e,f,l) on conflict do nothing returning 1",[a.id,req.user.id,ch.map(x=>x.email),ch.map(x=>x.first_name),ch.map(x=>x.last_name)]);added+=rows.length}
 const updated=ok.length-fresh.length;
 for(const x of ok.filter(x=>have.has(x.email))){if(x.first_name||x.last_name)await q('update contacts set first_name=coalesce($3,first_name),last_name=coalesce($4,last_name) where audience_id=$1 and email=$2',[a.id,x.email,x.first_name,x.last_name])}
 res.status(201).json({added,existing:updated,invalid,duplicates:dup})
}));
r.patch('/:id/contacts/:cid',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a||!UUID.test(req.params.cid))return res.status(404).json({error:'not_found'});
 const b=req.body||{},sets=[],args=[a.id,req.params.cid];
 if('first_name'in b){args.push(clip(b.first_name,80));sets.push('first_name=$'+args.length)}
 if('last_name'in b){args.push(clip(b.last_name,80));sets.push('last_name=$'+args.length)}
 if('unsubscribed'in b){args.push(!!b.unsubscribed);sets.push('unsubscribed=$'+args.length,'unsubscribed_at='+(b.unsubscribed?'now()':'null'))}
 if(!sets.length)return res.status(400).json({error:'nothing_to_update'});
 const rows=await q('update contacts set '+sets.join(',')+' where audience_id=$1 and id=$2 returning id',args);
 rows.length?res.json({ok:true}):res.status(404).json({error:'not_found'})
}));
r.delete('/:id/contacts/:cid',w(async(req,res)=>{
 const a=await mine(req.user.id,req.params.id);if(!a||!UUID.test(req.params.cid))return res.status(404).json({error:'not_found'});
 const rows=await q('delete from contacts where audience_id=$1 and id=$2 returning id',[a.id,req.params.cid]);
 rows.length?res.json({ok:true}):res.status(404).json({error:'not_found'})
}));
module.exports=r;
