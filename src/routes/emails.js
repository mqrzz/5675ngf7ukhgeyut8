// POST /api/emails  — send (API key or session). GET /api/emails, GET /api/emails/:id — list / detail (the dashboard uses these too).
// Flow: validate -> resolve the sender (own verified domain, or a claimed Geserd sub-domain) -> plan quota -> drop suppressed recipients ->
// store row (queued) -> hand to Postfix (DKIM-signed with the domain's own key, or by OpenDKIM for sub-domains) -> status sent/failed.
const r=require('express').Router();const c=require('crypto');
const {q}=require('../db');const {w,need}=require('../auth');const {dec}=require('../secret');
const PLANS=require('../plans');const {transport,FROM}=require('../mailer');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const MAILHOST=(process.env.MAIL_HOST||'geserd.com').replace(/^mail\./,'');
const ADDR=/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const CTRL=/[\r\n\u0000]/;
function parseAddr(s){s=String(s||'').trim();const m=/^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);const email=(m?m[2]:s).trim().toLowerCase();return{name:m?m[1].trim():'',email}}
const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
const bad=(res,error,extra)=>res.status(error==='quota_exceeded'?429:error==='domain_not_verified'?403:422).json({error,...extra});
// simple per-user rate limit (matches the "2 requests / sec" shown in the dashboard)
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>5000)hits.delete(k)},10000).unref();
function rate(uid){const n=Date.now(),v=hits.get(uid);if(!v||n-v.t>=1000){hits.set(uid,{t:n,n:1});return true}if(v.n>=2)return false;v.n++;return true}
const FOOT_TXT='\n\n--\nSent with Geserd · https://geserd.com';
const FOOT_HTML='<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a;">Sent with <a href="https://geserd.com" style="color:#8a8a8a;">Geserd</a></div>';
r.use(need);
r.post('/',w(async(req,res)=>{
 const uid=req.user.id,b=req.body||{};
 if(!rate(uid))return res.status(429).json({error:'rate_limited'});
 const from=parseAddr(b.from),to=arr(b.to).map(x=>parseAddr(x).email),reply=b.reply_to?parseAddr(Array.isArray(b.reply_to)?b.reply_to[0]:b.reply_to).email:null;
 const subject=String(b.subject==null?'':b.subject),html=b.html==null?null:String(b.html),text=b.text==null?null:String(b.text);
 if(!ADDR.test(from.email)||CTRL.test(from.name)||CTRL.test(from.email))return bad(res,'invalid_from');
 if(!to.length||to.length>50||to.some(a=>!ADDR.test(a)))return bad(res,'invalid_to');
 if(reply&&(!ADDR.test(reply)))return bad(res,'invalid_reply_to');
 if(CTRL.test(subject)||subject.length>998)return bad(res,'invalid_subject');
 if(!html&&!text)return bad(res,'empty_body');
 // --- sender: own verified domain, or a claimed Geserd sub-domain ---
 const dom=from.email.split('@')[1];let signer=null,ok=false;
 const [d]=await q("select * from domains where user_id=$1 and name=$2 and status='verified' and sending_ok",[uid,dom]);
 if(d){ok=true;signer={domainName:d.name,keySelector:d.dkim_selector,privateKey:dec(d.dkim_private_enc)}}
 else if(dom.endsWith('.'+BASE)){const slug=dom.slice(0,-(BASE.length+1));if(slug&&!slug.includes('.')&&(await q('select 1 from subdomains where slug=$1 and user_id=$2',[slug,uid])).length)ok=true}
 if(!ok)return bad(res,'domain_not_verified',{domain:dom});
 // --- plan quota (every recipient counts as one email) ---
 const [{plan}]=await q('select plan from users where id=$1',[uid]);const P=PLANS[plan]||PLANS.free;
 const [u]=await q("select coalesce(sum(jsonb_array_length(to_addrs)) filter(where created_at>=date_trunc('month',now())),0)::int m,coalesce(sum(jsonb_array_length(to_addrs)) filter(where created_at>=date_trunc('day',now())),0)::int d from emails where user_id=$1 and direction='out' and status<>'rejected'",[uid]);
 if(P.daily&&u.d+to.length>P.daily)return bad(res,'quota_exceeded',{scope:'daily',limit:P.daily,used:u.d});
 if(P.monthly&&u.m+to.length>P.monthly)return bad(res,'quota_exceeded',{scope:'monthly',limit:P.monthly,used:u.m});
 // --- suppression list ---
 const sup=new Set((await q('select address from suppressions where user_id=$1 and address=any($2)',[uid,to])).map(x=>x.address));
 const rcpt=to.filter(a=>!sup.has(a));
 if(!rcpt.length)return bad(res,'all_recipients_suppressed');
 // --- free plan: visible "Sent with Geserd" mark ---
 let H=html,T=text;
 if(plan==='free'){if(H)H=/<\/body>/i.test(H)?H.replace(/<\/body>/i,FOOT_HTML+'</body>'):H+FOOT_HTML;T=(T||'')+(T||!H?FOOT_TXT:'')}
 const id=c.randomUUID(),mid='<'+id+'@'+MAILHOST+'>';
 await q("insert into emails(id,user_id,domain_id,api_key_id,direction,from_addr,to_addrs,subject,html,text_body,message_id,status) values($1,$2,$3,null,'out',$4,$5,$6,$7,$8,$9,'queued')",[id,uid,d?d.id:null,from.email,JSON.stringify(rcpt),subject,html,text,mid]);
 try{
  const info=await transport.sendMail({from:{name:from.name,address:from.email},to:rcpt,replyTo:reply||undefined,subject,html:H||undefined,text:T||undefined,messageId:mid,
   envelope:{from:FROM,to:rcpt},dkim:signer||undefined,headers:{'X-Geserd-Id':id}});
  await q("update emails set status='sent' where id=$1",[id]);
  await q("insert into events(email_id,type,data) values($1,'sent',$2)",[id,JSON.stringify({accepted:info.accepted||rcpt,suppressed:[...sup]})]);
  res.json({id,suppressed:[...sup]});
 }catch(e){
  console.error('send failed',id,e&&e.message);
  await q("update emails set status='failed',error=$2 where id=$1",[id,String(e&&e.message||e).slice(0,500)]);
  await q("insert into events(email_id,type,data) values($1,'failed',$2)",[id,JSON.stringify({error:String(e&&e.message||e).slice(0,500)})]);
  res.status(502).json({error:'send_failed',id});
 }
}));
r.get('/',w(async(req,res)=>{
 const lim=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25));const args=[req.user.id];let where='user_id=$1';
 if(req.query.direction==='in'||req.query.direction==='out'){args.push(req.query.direction);where+=' and direction=$'+args.length}
 if(req.query.status){args.push(String(req.query.status));where+=' and status=$'+args.length}
 if(req.query.before){const t=new Date(req.query.before);if(!isNaN(t)){args.push(t.toISOString());where+=' and created_at<$'+args.length}}
 const rows=await q('select id,direction,from_addr,to_addrs,subject,status,created_at from emails where '+where+' order by created_at desc limit '+(lim+1),args);
 res.json({data:rows.slice(0,lim),next:rows.length>lim?rows[lim-1].created_at:null});
}));
r.get('/:id',w(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(404).json({error:'not_found'});
 const [e]=await q('select * from emails where id=$1 and user_id=$2',[req.params.id,req.user.id]);if(!e)return res.status(404).json({error:'not_found'});
 const ev=await q('select type,data,created_at from events where email_id=$1 order by id',[e.id]);
 res.json({id:e.id,direction:e.direction,from:e.from_addr,to:e.to_addrs,subject:e.subject,html:e.html,text:e.text_body,status:e.status,error:e.error,created_at:e.created_at,events:ev});
}));
module.exports=r;
