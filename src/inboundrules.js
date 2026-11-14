const c=require('crypto');
const {q}=require('./db');
const WH=require('./webhooks');
const {emit}=require('./events');
const rx=g=>new RegExp('^'+String(g).toLowerCase().replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$');
async function match(uid,addrs){
 const rules=await q('select * from inbound_rules where user_id=$1 and enabled order by position,created_at',[uid]);
 for(const r of rules){for(const a of addrs){const i=a.lastIndexOf('@');const dom=a.slice(i+1),loc=a.slice(0,i);if(dom!==r.domain)continue;try{if(rx(r.match).test(loc))return{rule:r,addr:a}}catch(e){}}}
 return null}
async function hit(rule){await q('update inbound_rules set hits=hits+1,last_hit_at=now() where id=$1',[rule.id])}
function automated(p){
 const h=k=>{const v=p.headers.get(k);return v==null?'':(typeof v==='string'?v:(v.text||JSON.stringify(v)))};
 const as=h('auto-submitted');if(as&&as.toLowerCase()!=='no')return true;
 if(h('x-geserd-forwarded')||h('list-id')||h('list-unsubscribe'))return true;
 if(/bulk|junk|list/i.test(h('precedence')))return true;
 return false}
async function run(hitInfo,ctx){
 const {rule,addr}=hitInfo,{id,uid,from,p}=ctx;
 await hit(rule);
 if(rule.action==='store')return;
 const send=require('./send').send;
 try{
  if(rule.action==='forward'){
   if(automated(p))return;
   const to=String(rule.target||'').split(/[\s,;]+/).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0,5);
   if(!to.length)return;
   const who=((p.from&&p.from.value&&p.from.value[0]&&p.from.value[0].name)||from).replace(/[\r\n<>\\\"]/g,'').slice(0,80);
   await send(uid,{from:'\"'+who+' via '+addr.split('@')[1]+'\" <'+addr+'>',to,reply_to:from,subject:p.subject||'(no subject)',html:p.html||undefined,text:p.text||(p.html?undefined:'(empty)'),attachments:(p.attachments||[]).map(a=>({filename:String(a.filename||'file').replace(/[\\/]/g,'_'),content:a.content,content_type:a.contentType})),headers:{'x-geserd-forwarded':'1'}},null);
   await emit(id,'rule_forwarded',{rule:rule.id,to});
  }else if(rule.action==='webhook'){
   const payload={type:'email.received',created_at:new Date().toISOString(),data:{email_id:id,from,to:[addr],subject:p.subject||'',text:p.text||null,html:p.html||null,attachments:(p.attachments||[]).map(a=>({filename:a.filename||null,content_type:a.contentType,size:a.size}))}};
   const res=await WH.post({url:rule.target,secret:rule.secret||''},{id:c.randomUUID(),payload});
   await emit(id,res&&res.ok?'rule_webhook':'rule_failed',{rule:rule.id,error:res&&res.ok?undefined:(res&&res.error)||'failed'});
  }else if(rule.action==='autoreply'){
   if(automated(p))return;
   if(/(^|[._-])(no-?reply|mailer-daemon|postmaster|bounce)/i.test(from)||from===addr)return;
   const[x]=await q('insert into inbound_replied(rule_id,sender) values($1,$2) on conflict(rule_id,sender) do update set at=now() where inbound_replied.at<now()-interval \'24 hours\' returning at',[rule.id,from]);
   if(!x)return;
   await send(uid,{from:addr,to:[from],subject:rule.reply_subject||('Re: '+(p.subject||'')),text:rule.reply_body||'',headers:{'in-reply-to':p.messageId||'','auto-submitted':'auto-replied','x-geserd-forwarded':'autoreply'}},null);
   await emit(id,'rule_autoreplied',{rule:rule.id});
  }
 }catch(e){await emit(id,'rule_failed',{rule:rule.id,error:String(e&&e.code||e&&e.message||e).slice(0,200)}).catch(()=>{})}
}
module.exports={match,run,hit};
