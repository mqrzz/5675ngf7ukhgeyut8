const {q}=require('./db');
const KEY={bounced:'bounce',complained:'complaint',quota:'quota',domain:'domain',ticket:'ticket'};
async function notify(userId,type,title,body,link,dedupe){
 try{
  const [u]=await q('select notify from users where id=$1',[userId]);
  if(!u)return false;
  const pref=(u.notify||{})[KEY[type]||type];
  if(pref===false)return false;
  const r=await q('insert into notifications(user_id,type,title,body,link,dedupe) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id',[userId,type,String(title).slice(0,160),body?String(body).slice(0,500):null,link||null,dedupe||null]);
  return r.length>0;
 }catch(e){console.error('notify',e.message);return false}}
module.exports={notify};
