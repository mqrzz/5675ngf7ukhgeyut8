const c=require('crypto');const MailComposer=require('nodemailer/lib/mail-composer');
const {q}=require('./db');const {dec}=require('./secret');const PLANS=require('./plans');
const {transport,FROM}=require('./mailer');const {emit}=require('./events');const {toText}=require('./text');const {notify}=require('./notify');const spam=require('./spam');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const MAILHOST=(process.env.MAIL_HOST||'geserd.com').replace(/^mail\./,'');
const ADDR=/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const CTRL=/[\r\n\u0000]/;
const BLOCKED=/\.(exe|scr|bat|cmd|com|pif|vbs|vbe|js|jse|jar|msi|lnk|ps1|reg|dll|hta|cpl|wsf)$/i;
const HDR=new Set(['list-unsubscribe','list-unsubscribe-post','x-entity-ref-id','x-priority']);
const MAXATT=10*1024*1024;
const E=(code,extra)=>Object.assign(new Error(code),{code,extra:extra||{}});
const STATUS={quota_exceeded:429,rate_limited:429,domain_not_verified:403,send_failed:502,spam_rejected:422};
const status=code=>STATUS[code]||422;
function parseAddr(s){s=String(s||'').trim();const m=/^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);const email=(m?m[2]:s).trim().toLowerCase();return{name:m?m[1].trim():'',email}}
const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>5000)hits.delete(k)},10000).unref();
function rate(uid){const n=Date.now(),v=hits.get(uid);if(!v||n-v.t>=1000){hits.set(uid,{t:n,n:1});return true}if(v.n>=2)return false;v.n++;return true}
const FOOT_TXT='\n\n--\nSent with Geserd · https://geserd.com';
const FOOT_HTML='<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a;">Sent with <a href="https://geserd.com" style="color:#8a8a8a;">Geserd</a></div>';
function attachments(list){
 const out=[];let total=0;
 for(const a of arr(list)){
  if(!a||typeof a!=='object')throw E('invalid_attachment');
  const name=String(a.filename||'').trim().slice(0,200);
  if(!name||CTRL.test(name)||/[\\/]/.test(name))throw E('invalid_attachment');
  if(BLOCKED.test(name))throw E('attachment_not_allowed',{filename:name});
  let buf;
  if(Buffer.isBuffer(a.content))buf=a.content;
  else if(typeof a.content==='string'&&a.content.length&&/^[A-Za-z0-9+/=\s]+$/.test(a.content))buf=Buffer.from(a.content,'base64');
  else throw E('invalid_attachment');
  total+=buf.length;if(total>MAXATT||out.length>=10)throw E('attachments_too_large');
  const ct=String(a.content_type||a.contentType||'application/octet-stream').slice(0,100);
  if(CTRL.test(ct))throw E('invalid_attachment');
  const cid=a.cid?String(a.cid).slice(0,200):undefined;if(cid&&CTRL.test(cid))throw E('invalid_attachment');
  out.push({filename:name,content:buf,contentType:ct,cid,contentDisposition:cid?'inline':'attachment'})}
 return out}
function customHeaders(h){
 const out={};if(!h||typeof h!=='object')return out;
 for(const[k,v]of Object.entries(h)){const key=String(k).toLowerCase();if(!HDR.has(key))continue;const val=String(v);if(CTRL.test(val)||val.length>998)throw E('invalid_header',{header:k});
  if(key==='list-unsubscribe'&&!/^(\s*<[^<>\s]+>\s*,?)+$/.test(val))throw E('invalid_header',{header:k});
  out[k]=val}
 return out}
function normalize(b){
 const from=parseAddr(b.from),list=k=>arr(b[k]).map(x=>parseAddr(x).email);
 const to=list('to'),cc=list('cc'),bcc=list('bcc');
 const reply=b.reply_to?parseAddr(Array.isArray(b.reply_to)?b.reply_to[0]:b.reply_to).email:null;
 const subject=String(b.subject==null?'':b.subject),html=b.html?String(b.html):null,text=b.text?String(b.text):null;
 if(!ADDR.test(from.email)||CTRL.test(from.name)||CTRL.test(from.email))throw E('invalid_from');
 const all=[...new Set([...to,...cc,...bcc])];
 if(!all.length||all.length>50||all.some(a=>!ADDR.test(a)))throw E('invalid_to');
 if(reply&&!ADDR.test(reply))throw E('invalid_reply_to');
 if(CTRL.test(subject)||subject.length>998)throw E('invalid_subject');
 if(!html&&!text)throw E('empty_body');
 return{from,to,cc,bcc,all,reply,subject,html,text,attachments:attachments(b.attachments),headers:customHeaders(b.headers)}}
async function resolve(uid,m){
 const dom=m.from.email.split('@')[1];let signer=null,ok=false;
 const [d]=await q("select * from domains where user_id=$1 and name=$2 and status='verified' and sending_ok",[uid,dom]);
 if(d){ok=true;signer={domainName:d.name,keySelector:d.dkim_selector,privateKey:dec(d.dkim_private_enc)}}
 else if(dom.endsWith('.'+BASE)){const slug=dom.slice(0,-(BASE.length+1));if(slug&&!slug.includes('.')&&(await q('select 1 from subdomains where slug=$1 and user_id=$2',[slug,uid])).length)ok=true}
 if(!ok)throw E('domain_not_verified',{domain:dom});
 return{d,signer}}
function compose(m,plan,id,mid,rcpt){
 const free=plan==='free';let H=m.html,T=m.text!=null?m.text:(m.html?toText(m.html):null);
 if(free){if(H)H=/<\/body>/i.test(H)?H.replace(/<\/body>/i,FOOT_HTML+'</body>'):H+FOOT_HTML;T=(T||'')+FOOT_TXT}
 const keep=a=>a.filter(x=>rcpt.includes(x));
 return{from:{name:m.from.name,address:m.from.email},to:keep(m.to),cc:keep(m.cc),bcc:keep(m.bcc),replyTo:m.reply||undefined,subject:m.subject,html:H||undefined,text:T||undefined,
  attachments:m.attachments,messageId:mid,date:new Date(),headers:{'X-Geserd-Id':id,...m.headers}}}
async function raw(opts){const o={...opts,bcc:undefined};if(!o.to.length&&!o.cc.length)o.to=[opts.bcc[0]];return new MailComposer(o).compile().build()}
async function score(opts){try{return await spam.check(await raw(opts))}catch(e){console.error('spam score',e.message);return null}}
async function send(uid,b,keyId){
 const m=normalize(b);
 if(!rate(uid))throw E('rate_limited');
 const {d,signer}=await resolve(uid,m);
 const [{plan}]=await q('select plan from users where id=$1',[uid]);const P=PLANS[plan]||PLANS.free;
 const [u]=await q("select coalesce(sum(jsonb_array_length(to_addrs)) filter(where created_at>=date_trunc('month',now())),0)::int m,coalesce(sum(jsonb_array_length(to_addrs)) filter(where created_at>=date_trunc('day',now())),0)::int d from emails where user_id=$1 and direction='out' and status<>'rejected'",[uid]);
 if(P.daily&&u.d+m.all.length>P.daily)throw E('quota_exceeded',{scope:'daily',limit:P.daily,used:u.d});
 if(P.monthly&&u.m+m.all.length>P.monthly)throw E('quota_exceeded',{scope:'monthly',limit:P.monthly,used:u.m});
 const sup=new Set((await q('select address from suppressions where user_id=$1 and address=any($2)',[uid,m.all])).map(x=>x.address));
 const rcpt=m.all.filter(a=>!sup.has(a));
 if(!rcpt.length)throw E('all_recipients_suppressed');
 const id=c.randomUUID(),mid='<'+id+'@'+MAILHOST+'>';
 const opts=compose(m,plan,id,mid,rcpt);
 const sc=await score(opts);
 const block=+process.env.SPAM_BLOCK_SCORE||0;
 if(sc&&block&&sc.score>=block)throw E('spam_rejected',{score:sc.score,rules:sc.rules.slice(0,8)});
 const meta=m.attachments.map(a=>({filename:a.filename,content_type:a.contentType,size:a.content.length}));
 await q("insert into emails(id,user_id,domain_id,api_key_id,direction,from_addr,to_addrs,subject,html,text_body,message_id,status,attachments,spam_score,spam_rules) values($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,'queued',$11,$12,$13)",
  [id,uid,d?d.id:null,keyId||null,m.from.email,JSON.stringify(rcpt),m.subject,m.html,m.text,mid,JSON.stringify(meta),sc?sc.score:null,sc?JSON.stringify(sc.rules):null]);
 const mon=new Date().toISOString().slice(0,7),day=new Date().toISOString().slice(0,10);
 for(const[lim,used,scope,key]of[[P.monthly,u.m,'monthly',mon],[P.daily,u.d,'daily',day]]){if(!lim)continue;const before=used/lim,after=(used+rcpt.length)/lim;for(const th of[0.8,1])if(before<th&&after>=th)notify(uid,'quota',th===1?'quota_full':'quota_80',scope+':'+Math.round(th*100),'/app/settings/usage/','quota:'+scope+':'+th+':'+key)}
 try{
  const info=await transport.sendMail({...opts,envelope:{from:FROM,to:rcpt},dkim:signer||undefined});
  await emit(id,'sent',{accepted:info.accepted||rcpt,suppressed:[...sup]});
  return{id,suppressed:[...sup]};
 }catch(e){
  console.error('send failed',id,e&&e.message);
  await q("update emails set error=$2 where id=$1",[id,String(e&&e.message||e).slice(0,500)]);
  await emit(id,'failed',{error:String(e&&e.message||e).slice(0,500)});
  throw E('send_failed',{id})}}
async function check(uid,b){
 const m=normalize({...b,to:b.to||b.cc||b.bcc||'check@example.com'});
 const [{plan}]=await q('select plan from users where id=$1',[uid]);
 const id=c.randomUUID(),opts=compose(m,plan,id,'<'+id+'@'+MAILHOST+'>',m.all);
 const dom=m.from.email.split('@')[1];
 const [d]=await q("select status,sending_ok from domains where user_id=$1 and name=$2 order by (status='verified') desc limit 1",[uid,dom]);
 const sc=await score(opts);
 const notes=[];
 if(!m.text&&m.html)notes.push('text_part_generated');
 if(m.subject.length<3)notes.push('subject_too_short');
 if(m.subject===m.subject.toUpperCase()&&/[A-Z]{6,}/.test(m.subject))notes.push('subject_all_caps');
 if(m.html&&(m.html.match(/<a\s/gi)||[]).length>10)notes.push('many_links');
 if(m.html&&!/<img[^>]+alt=/i.test(m.html)&&/<img/i.test(m.html))notes.push('images_without_alt');
 if(!m.headers['List-Unsubscribe']&&!m.headers['list-unsubscribe'])notes.push('no_list_unsubscribe');
 return{domain:{name:dom,verified:!!(d&&d.status==='verified'&&d.sending_ok),subdomain:dom.endsWith('.'+BASE)},score:sc,notes}}
module.exports={send,check,status,E,parseAddr};
