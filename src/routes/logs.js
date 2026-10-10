const r=require('express').Router();const {q}=require('../db');const {w,need,sessionOnly}=require('../auth');const PLANS=require('../plans');
r.use(need,sessionOnly);
const UUID=/^[0-9a-f-]{36}$/i;
const TYPES=['sent','delivered','delayed','bounced','complained','failed','received'];
const METHODS=['GET','POST','PATCH','PUT','DELETE','SMTP'];
const like=s=>'%'+String(s).replace(/[\\%_]/g,'\\$&')+'%';
async function window_(uid,days){
 const[u]=await q('select plan from users where id=$1',[uid]);const max=(PLANS[u.plan]||PLANS.free).logDays;
 let d=parseInt(days,10);if(!(d>0))d=max;d=Math.min(d,max);
 return{days:d,max,since:new Date(Date.now()-d*86400000).toISOString()}
}
function reqFilter(uid,qs,since){
 const a=[uid,since];let s='l.user_id=$1 and l.created_at>=$2';
 const st=String(qs.status||'');
 if(/^[2345]xx$/.test(st)){a.push(+st[0]*100);s+=' and l.status>=$'+a.length+' and l.status<$'+a.length+'+100'}
 else if(/^\d{3}$/.test(st)){a.push(+st);s+=' and l.status=$'+a.length}
 const m=String(qs.method||'').toUpperCase();if(METHODS.includes(m)){a.push(m);s+=' and l.method=$'+a.length}
 if(qs.key&&UUID.test(String(qs.key))){a.push(qs.key);s+=' and l.key_id=$'+a.length}
 const t=String(qs.q||'').trim().slice(0,100);if(t){a.push(like(t));s+=' and l.path ilike $'+a.length}
 return{s,a}
}
const DOMX="case when m.direction='in' then lower(split_part(coalesce(m.to_addrs->>0,''),'@',2)) else lower(split_part(m.from_addr,'@',2)) end";
function evFilter(uid,qs,since){
 const a=[uid,since];let s='e.user_id=$1 and e.created_at>=$2';
 const t=String(qs.type||'');if(TYPES.includes(t)){a.push(t);s+=' and e.type=$'+a.length}
 const d=String(qs.direction||'');if(d==='in'||d==='out'){a.push(d);s+=' and m.direction=$'+a.length}
 const dm=String(qs.domain||'').toLowerCase();if(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(dm)){a.push(dm);s+=' and '+DOMX+'=$'+a.length}
 const x=String(qs.q||'').trim().slice(0,100);if(x){a.push(like(x));const n=a.length;s+=' and (m.subject ilike $'+n+' or m.from_addr ilike $'+n+' or m.to_addrs::text ilike $'+n+" or e.data->>'recipient' ilike $"+n+')'}
 return{s,a}
}
const RCOLS='l.id,l.method,l.path,l.status,l.ms,l.via,l.ip,l.created_at,k.name key_name,k.prefix key_prefix';
const ECOLS="e.id,e.type,e.created_at,e.data->>'recipient' recipient,e.data->>'dsn' dsn,e.data->>'detail' detail,m.id email_id,m.direction,m.from_addr,m.to_addrs,m.subject";
const RFROM='from api_logs l left join api_keys k on k.id=l.key_id';
const EFROM='from events e join emails m on m.id=e.email_id';
r.get('/',w(async(req,res)=>{
 const kind=req.query.kind==='events'?'events':'requests';
 const win=await window_(req.user.id,req.query.days);
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||50));
 const f=kind==='events'?evFilter(req.user.id,req.query,win.since):reqFilter(req.user.id,req.query,win.since);
 const col=kind==='events'?'e':'l';
 const a=f.a.slice();let where=f.s;
 const b=parseInt(req.query.before,10);if(b>0){a.push(b);where+=' and '+col+'.id<$'+a.length}
 const rows=await q('select '+(kind==='events'?ECOLS:RCOLS)+' '+(kind==='events'?EFROM:RFROM)+' where '+where+' order by '+col+'.id desc limit '+(lim+1),a);
 const data=rows.slice(0,lim);
 const[c]=await q('select count(*)::int n '+(kind==='events'?EFROM:RFROM)+' where '+f.s,f.a);
 res.set('Cache-Control','no-store');
 res.json({kind,data,total:c.n,next:rows.length>lim?data[data.length-1].id:null,days:win.days,retention_days:win.max})
}));
r.get('/export',w(async(req,res)=>{
 const kind=req.query.kind==='events'?'events':'requests';
 const win=await window_(req.user.id,req.query.days);
 const f=kind==='events'?evFilter(req.user.id,req.query,win.since):reqFilter(req.user.id,req.query,win.since);
 const col=kind==='events'?'e':'l';
 const rows=await q('select '+(kind==='events'?ECOLS:RCOLS)+' '+(kind==='events'?EFROM:RFROM)+' where '+f.s+' order by '+col+'.id desc limit 10000',f.a);
 const e=v=>{v=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return/[",\n\r;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
 const head=kind==='events'?'time,type,direction,from,to,subject,recipient,dsn,detail,email_id':'time,method,path,status,ms,via,key,ip';
 const lines=rows.map(x=>(kind==='events'?[x.created_at.toISOString(),x.type,x.direction,x.from_addr,(x.to_addrs||[]).join(' '),x.subject,x.recipient,x.dsn,x.detail,x.email_id]:[x.created_at.toISOString(),x.method,x.path,x.status,x.ms,x.via,x.key_name||'',x.ip||'']).map(e).join(','));
 res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="'+kind+'-log.csv"').send([head].concat(lines).join('\n')+'\n')
}));
r.get('/requests/:id',w(async(req,res)=>{
 if(!/^\d{1,18}$/.test(req.params.id))return res.status(404).json({error:'not_found'});
 const[l]=await q('select l.id,l.method,l.path,l.status,l.ms,l.via,l.ip,l.ua,l.req,l.res,l.created_at,k.name key_name,k.prefix key_prefix '+RFROM+' where l.id=$1 and l.user_id=$2',[req.params.id,req.user.id]);
 if(!l)return res.status(404).json({error:'not_found'});
 res.set('Cache-Control','no-store');res.json(l)
}));
module.exports=r;
