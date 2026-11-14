const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const SHARED=(process.env.SHARED_DOMAIN||('users.'+BASE)).toLowerCase();
const RESERVED=new Set(['www','mail','smtp','imap','pop','api','app','admin','root','postmaster','abuse','security','support','noreply','no-reply','donotreply','billing','status','docs','blog','help','ftp','ns1','ns2','dns','mx','email','send','geserd','dashboard','login','signup','test','demo','info','hello','contact','sales','legal','press','privacy','team','office','webmaster','hostmaster','mailer-daemon','bounce','bounces','notifications','news','newsletter','owner','ceo','staff','official','antviz']);
const RX=/^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/;
function valid(h){return RX.test(h)&&!/[._-]{2}/.test(h)}
function handleOf(local){return String(local||'').toLowerCase().split('+')[0]}
module.exports={BASE,SHARED,RESERVED,valid,handleOf};
