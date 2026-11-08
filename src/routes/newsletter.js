const r=require('express').Router();const dns=require('dns').promises;const c=require('crypto');const {q}=require('../db');const {w}=require('../auth');const BM=require('../brandmail');
const RX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,LANGS=['en','ru','fr','de'];
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>3600000)hits.delete(k)},600000).unref();
const T={
 en:{subject:'Confirm your subscription to Geserd news',tag:'Newsletter',heading:'Confirm your subscription',paras:['Press the button to start receiving Geserd news. If you did not ask for this, ignore this email and nothing will be sent.'],cta:'Confirm subscription',note:'You can unsubscribe at any time with the link in every message.'},
 ru:{subject:'Подтвердите подписку на новости Geserd',tag:'Рассылка',heading:'Подтвердите подписку',paras:['Нажмите кнопку, чтобы получать новости Geserd. Если вы не оставляли заявку, просто проигнорируйте письмо — ничего отправляться не будет.'],cta:'Подтвердить подписку',note:'Отписаться можно в любой момент по ссылке в каждом письме.'},
 fr:{subject:'Confirmez votre abonnement aux actualités Geserd',tag:'Newsletter',heading:'Confirmez votre abonnement',paras:['Appuyez sur le bouton pour recevoir les actualités de Geserd. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : rien ne sera envoyé.'],cta:'Confirmer l’abonnement',note:'Vous pouvez vous désabonner à tout moment grâce au lien présent dans chaque message.'},
 de:{subject:'Bestätigen Sie Ihr Abonnement der Geserd-News',tag:'Newsletter',heading:'Abonnement bestätigen',paras:['Klicken Sie auf die Schaltfläche, um die Neuigkeiten von Geserd zu erhalten. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail, es wird nichts gesendet.'],cta:'Abonnement bestätigen',note:'Sie können sich jederzeit über den Link in jeder Nachricht abmelden.'}};
async function human(token,ip){
 const sec=process.env.TURNSTILE_SECRET;if(!sec)return true;
 if(!token||typeof token!=='string'||token.length>2048)return false;
 try{const body=new URLSearchParams({secret:sec,response:token,remoteip:String(ip||'')});
  const x=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body,signal:AbortSignal.timeout(8000)});
  const j=await x.json();return !!j.success}catch(e){console.error('turnstile check failed',e.message);return false}
}
async function mailDomainOk(email){
 const d=email.split('@')[1];
 try{const mx=await dns.resolveMx(d);if(mx&&mx.length)return true}catch(e){if(e.code!=='ENODATA'&&e.code!=='ENOTFOUND')return true}
 try{await dns.resolve4(d);return true}catch(e){return !(e.code==='ENODATA'||e.code==='ENOTFOUND')}
}
r.post('/subscribe',w(async(req,res)=>{
 const b=req.body||{};if(b.website)return res.json({ok:true});
 const email=String(b.email||'').trim().toLowerCase().slice(0,254),lang=LANGS.includes(b.lang)?b.lang:'en';
 if(!RX.test(email))return res.status(400).json({error:'invalid_email'});
 if(!(await human(b.ts,req.ip)))return res.status(400).json({error:'captcha'});
 if(!(await mailDomainOk(email)))return res.status(400).json({error:'invalid_email'});
 const k=req.ip,h=hits.get(k)||{t:Date.now(),n:0};if(Date.now()-h.t>3600000){h.t=Date.now();h.n=0}
 if(h.n>=6)return res.status(429).json({error:'rate_limited'});h.n++;hits.set(k,h);
 const [ex]=await q('select email,token,confirmed_at,unsubscribed_at from newsletter_subs where email=$1',[email]);
 if(ex&&ex.confirmed_at&&!ex.unsubscribed_at)return res.json({ok:true,already:true});
 const token=c.randomBytes(24).toString('hex');
 await q('insert into newsletter_subs(email,lang,token,ip) values($1,$2,$3,$4) on conflict(email) do update set token=$3,lang=$2,confirmed_at=null,unsubscribed_at=null',[email,lang,token,req.ip]);
 const t=T[lang];
 try{await BM.send(email,{lang,subject:t.subject,tag:t.tag,heading:t.heading,paras:t.paras,cta:{label:t.cta,url:BM.APP+'/newsletter/?a=confirm&t='+token},note:t.note})}catch(e){console.error('newsletter mail failed',e.message);return res.status(502).json({error:'mail_failed'})}
 res.json({ok:true})
}));
r.post('/confirm',w(async(req,res)=>{
 const t=String((req.body||{}).token||'');if(!/^[0-9a-f]{48}$/.test(t))return res.status(400).json({error:'invalid_token'});
 const rows=await q('update newsletter_subs set confirmed_at=coalesce(confirmed_at,now()),unsubscribed_at=null where token=$1 returning email',[t]);
 if(!rows.length)return res.status(404).json({error:'invalid_token'});res.json({ok:true})
}));
r.post('/unsubscribe',w(async(req,res)=>{
 const t=String((req.body||{}).token||'');if(!/^[0-9a-f]{48}$/.test(t))return res.status(400).json({error:'invalid_token'});
 const rows=await q('update newsletter_subs set unsubscribed_at=now() where token=$1 returning email',[t]);
 if(!rows.length)return res.status(404).json({error:'invalid_token'});res.json({ok:true})
}));
module.exports=r;
