const {q}=require('./db');
const MA=require('./multiacct');
const COOKIE=/(?:^|; )gd_blk=1(?:;|$)/;
async function verdict(req,o){
 o=o||{};
 if(o.cookie&&COOKIE.test(req.headers.cookie||''))return 'blocked';
 const dev=MA.device(req);
 const ua=req.headers['user-agent']?String(req.headers['user-agent']).slice(0,300):'';
 if(dev.did){
  const[r]=await q("select 1 x from user_devices d join users u on u.id=d.user_id where d.did=$1 and u.status='blocked' limit 1",[dev.did]);
  if(r)return 'blocked'}
 if(dev.fp&&ua&&req.ip){
  const[r]=await q("select 1 x from user_devices d join users u on u.id=d.user_id where d.fp=$1 and d.ua=$2 and u.status='blocked' and exists(select 1 from sessions s where s.user_id=u.id and s.ip=$3 and s.created_at>now()-interval '60 days') limit 1",[dev.fp,ua,String(req.ip)]);
  if(r)return 'blocked'}
 return null}
function mark(res,on){
 res.append('Set-Cookie',on?'gd_blk=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax':'gd_blk=; Max-Age=0; Path=/; Secure; SameSite=Lax')}
module.exports={verdict,mark};
