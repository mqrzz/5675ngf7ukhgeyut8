const {q}=require('./db');
async function thread(uid,refs,own){
 const ids=[...new Set((refs||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
 if(ids.length){const[r]=await q('select thread_id from emails where user_id=$1 and message_id=any($2) and thread_id is not null order by created_at desc limit 1',[uid,ids]);if(r)return r.thread_id}
 return own}
module.exports={thread};
