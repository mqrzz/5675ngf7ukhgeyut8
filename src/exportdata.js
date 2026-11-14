const {q}=require('./db');
async function build(id){
 const [user]=await q('select id,email,name,plan,lang,notify,send_settings,status,created_at from users where id=$1',[id]);
 return {exported_at:new Date().toISOString(),user,
  domains:await q('select name,status,sending_ok,receiving_ok,created_at from domains where user_id=$1 order by created_at',[id]),
  api_keys:await q('select name,prefix,created_at,last_used_at,revoked_at from api_keys where user_id=$1 order by created_at',[id]),
  webhooks:await q('select url,events,active,created_at from webhooks where user_id=$1 order by created_at',[id]),
  templates:await q('select name,subject,html,text_body,created_at,updated_at from templates where user_id=$1 order by created_at',[id]),
  suppressions:await q('select address,reason,created_at from suppressions where user_id=$1 order by created_at',[id]),
  emails:await q('select direction,from_addr,to_addrs,subject,status,created_at from emails where user_id=$1 order by created_at desc limit 5000',[id]),
  tickets:await q("select t.subject,t.topic,t.status,t.created_at,(select json_agg(json_build_object('author',m.author,'body',m.body,'at',m.created_at) order by m.id) from ticket_messages m where m.ticket_id=t.id) messages from tickets t where t.user_id=$1 order by t.created_at",[id])};
}
module.exports={build};
