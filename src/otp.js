const c=require('crypto');const {q}=require('./db');const {send,E}=require('./send');const TPL=require('./template');
const MAX_ATTEMPTS=5,COOLDOWN=30,HOURLY=5;
const COPY={
 en:{subject:'Your {app} verification code',title:'Your verification code',lead:'Use this code to continue. It expires in {min} minutes.',ignore:'If you did not request this code, you can ignore this email.'},
 ru:{subject:'Ваш код подтверждения {app}',title:'Ваш код подтверждения',lead:'Введите этот код, чтобы продолжить. Он действует {min} мин.',ignore:'Если вы не запрашивали код, просто проигнорируйте это письмо.'},
 de:{subject:'Dein Bestätigungscode für {app}',title:'Dein Bestätigungscode',lead:'Gib diesen Code ein, um fortzufahren. Er ist {min} Minuten gültig.',ignore:'Wenn du diesen Code nicht angefordert hast, kannst du diese E-Mail ignorieren.'},
 fr:{subject:'Votre code de vérification {app}',title:'Votre code de vérification',lead:'Saisissez ce code pour continuer. Il expire dans {min} minutes.',ignore:"Si vous n'avez pas demandé ce code, vous pouvez ignorer cet e-mail."}
};
const hash=(salt,code)=>c.createHash('sha256').update(salt+':'+code).digest('hex');
const fill=(s,v)=>s.replace(/\{(app|min)\}/g,(m,k)=>v[k]);
function content(lang,code,min,app){
 const t=COPY[lang]||COPY.en,v={app:app||'',min:String(min)};
 const subject=fill(t.subject,v).replace(/\s{2,}/g,' ').replace(/\s+([,.!?])/g,'$1').trim();
 const e=TPL.esc;
 const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#18181b;"><tr><td style="padding:36px 36px 32px;"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">'+e(t.title)+'</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">'+e(fill(t.lead,v))+'</p><div style="padding:18px;background:#f4f4f5;border-radius:10px;text-align:center;font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:700;">'+e(code)+'</div><p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a;">'+e(t.ignore)+'</p></td></tr></table></td></tr></table></body></html>';
 const text=t.title+'\n\n'+code+'\n\n'+fill(t.lead,v)+'\n'+t.ignore;
 return{subject,html,text}}
async function issue(uid,keyId,b){
 const to=String((b&&b.to)||'').trim().toLowerCase();
 if(!/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(to))throw E('invalid_to');
 const from=String((b&&b.from)||'').trim();if(!from)throw E('invalid_from');
 const len=Math.max(4,Math.min(8,parseInt(b.length,10)||6)),ttl=Math.max(60,Math.min(3600,parseInt(b.ttl,10)||600));
 const lang=COPY[b.lang]?b.lang:'en',app=String(b.app_name||'').slice(0,60).replace(/[\r\n<>]/g,'').trim();
 const [recent]=await q("select count(*) filter(where created_at>now()-interval '1 hour')::int h,max(created_at) last from otp_codes where user_id=$1 and address=$2",[uid,to]);
 if(recent.h>=HOURLY)throw E('too_many_codes',{retry_after:3600});
 if(recent.last&&Date.now()-new Date(recent.last).getTime()<COOLDOWN*1000)throw E('cooldown',{retry_after:COOLDOWN});
 const code=String(c.randomInt(0,10**len)).padStart(len,'0'),salt=c.randomBytes(8).toString('hex');
 const [row]=await q("insert into otp_codes(user_id,address,code_hash,salt,expires_at) values($1,$2,$3,$4,now()+($5||' seconds')::interval) returning id,expires_at",[uid,to,hash(salt,code),salt,String(ttl)]);
 const min=Math.max(1,Math.round(ttl/60));
 let msg;
 if(b.template_id){msg={from,to,template_id:b.template_id,variables:{code,minutes:String(min),app:app}}}
 else{const k=content(lang,code,min,app);msg={from,to,subject:k.subject,html:k.html,text:k.text}}
 try{await send(uid,msg,keyId)}
 catch(e){await q('delete from otp_codes where id=$1',[row.id]);throw e}
 return{id:row.id,expires_at:row.expires_at,length:len}}
async function check(uid,b){
 const to=String((b&&b.to)||'').trim().toLowerCase(),code=String((b&&b.code)||'').trim();
 if(!to||!/^\d{4,8}$/.test(code))return{valid:false,reason:'invalid'};
 const [o]=await q('select id,salt,code_hash,attempts,expires_at,consumed_at from otp_codes where user_id=$1 and address=$2 order by created_at desc limit 1',[uid,to]);
 if(!o||o.consumed_at)return{valid:false,reason:'not_found'};
 if(new Date(o.expires_at)<new Date())return{valid:false,reason:'expired'};
 if(o.attempts>=MAX_ATTEMPTS)return{valid:false,reason:'too_many_attempts'};
 const got=Buffer.from(hash(o.salt,code),'hex'),want=Buffer.from(o.code_hash,'hex');
 if(got.length===want.length&&c.timingSafeEqual(got,want)){
  const r=await q('update otp_codes set consumed_at=now() where id=$1 and consumed_at is null returning id',[o.id]);
  return r.length?{valid:true}:{valid:false,reason:'not_found'}}
 const [u]=await q('update otp_codes set attempts=attempts+1 where id=$1 returning attempts',[o.id]);
 if(u.attempts>=MAX_ATTEMPTS)await q('update otp_codes set consumed_at=now() where id=$1',[o.id]);
 return{valid:false,reason:u.attempts>=MAX_ATTEMPTS?'too_many_attempts':'wrong_code',attempts_left:Math.max(0,MAX_ATTEMPTS-u.attempts)}}
async function stats(uid){
 const [s]=await q("select count(*)::int sent,count(*) filter(where consumed_at is not null and attempts<$2)::int verified from otp_codes where user_id=$1 and created_at>now()-interval '30 days'",[uid,MAX_ATTEMPTS]);
 const rows=await q('select address,created_at,expires_at,consumed_at,attempts from otp_codes where user_id=$1 order by created_at desc limit 20',[uid]);
 const mask=a=>{const [l,d]=a.split('@');return (l.length>2?l.slice(0,2):l.slice(0,1))+'***@'+d};
 return{sent:s.sent,verified:s.verified,recent:rows.map(r=>({to:mask(r.address),created_at:r.created_at,status:r.consumed_at&&r.attempts<MAX_ATTEMPTS?'verified':new Date(r.expires_at)<new Date()?'expired':r.attempts>=MAX_ATTEMPTS?'locked':'pending'}))}}
module.exports={issue,check,stats,COPY};
