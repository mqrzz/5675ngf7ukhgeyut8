const {q}=require('./db');
const RANK={queued:0,sent:1,delivered:2,bounced:3,complained:4,failed:3,received:2};
const HOOK={delayed:'delivery_delayed'};
async function emit(emailId,type,data){
 const [e]=await q('select id,user_id,direction,from_addr,to_addrs,subject,status,created_at from emails where id=$1',[emailId]);
 if(!e)return null;
 await q('insert into events(email_id,type,data) values($1,$2,$3)',[e.id,type,JSON.stringify(data||{})]);
 if(RANK[type]!=null&&(RANK[type]>(RANK[e.status]??0)||(type==='failed'&&e.status==='queued')))await q('update emails set status=$2 where id=$1',[e.id,type]);
 const rcpt=data&&data.recipient;
 if(rcpt&&((type==='bounced'&&/^5\./.test(data.dsn||'')&&!/^5\.7\./.test(data.dsn||''))||type==='complained'))
  await q('insert into suppressions(user_id,address,reason) values($1,$2,$3) on conflict do nothing',[e.user_id,String(rcpt).toLowerCase(),type==='complained'?'complained':'bounced']);
 await queueHooks(e,type,data);
 return e;
}
async function queueHooks(e,type,data){
 const name='email.'+(HOOK[type]||type);
 const hooks=await q("select id from webhooks where user_id=$1 and active and (events='{}' or $2=any(events))",[e.user_id,name]);
 if(!hooks.length)return;
 const payload={type:name,created_at:new Date().toISOString(),data:{email_id:e.id,from:e.from_addr,to:e.to_addrs,subject:e.subject||'',...(data||{})}};
 for(const h of hooks)await q('insert into webhook_deliveries(webhook_id,event,payload) values($1,$2,$3)',[h.id,name,JSON.stringify(payload)]);
}
module.exports={emit,EVENTS:['email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.received']};
