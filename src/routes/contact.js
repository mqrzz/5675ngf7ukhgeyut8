const r=require('express').Router();const {q}=require('../db');const {w}=require('../auth');const {transport,FROM}=require('../mailer');
const TOPICS=['general','sales','security','abuse','government','partnerships'];
const KIND={general:'support',sales:'enterprise',security:'security',abuse:'abuse',government:'government',partnerships:'partnerships'};
const OM=require('../orgmail');const EMAIL_RX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>3600000)hits.delete(k)},600000).unref();
const TOPIC_RU={general:'Общий вопрос',sales:'Enterprise и продажи',security:'Безопасность',abuse:'Жалоба на злоупотребление',government:'Госорганы',partnerships:'Сотрудничество'};
const LANG_RU={ru:'русский',en:'английский',fr:'французский',de:'немецкий'};
const MAXF=3,MAXB=4*1024*1024,MAXALL=8*1024*1024;
r.post('/',w(async(req,res)=>{
 const b=req.body||{};
 if(b.website)return res.json({ok:true});
 const name=String(b.name||'').replace(/[\r\n]/g,' ').trim().slice(0,80),email=String(b.email||'').trim().toLowerCase().slice(0,254),topic=TOPICS.includes(b.topic)?b.topic:'general',message=String(b.message||'').trim().slice(0,5000);
 const lang=LANG_RU[b.lang]?b.lang:'en',page=String(b.page||'').slice(0,300);
 if(!EMAIL_RX.test(email))return res.status(400).json({error:'invalid_email'});
 if(message.length<10)return res.status(400).json({error:'message_too_short'});
 const files=[];let all=0;
 for(const f of (Array.isArray(b.files)?b.files:[]).slice(0,MAXF)){
  const buf=Buffer.from(String(f&&f.data||''),'base64');if(!buf.length)continue;
  if(buf.length>MAXB)return res.status(413).json({error:'file_too_large'});all+=buf.length;
  files.push({filename:String(f.name||'file').replace(/[\r\n\/\\]/g,'_').slice(0,120),content:buf,contentType:String(f.type||'application/octet-stream').slice(0,100)})}
 if(all>MAXALL)return res.status(413).json({error:'file_too_large'});
 const [recent]=await q("select count(*)::int n from contact_messages where lower(email)=$1 and created_at>now()-interval '1 hour'",[email]);
 if(recent&&recent.n>=1)return res.status(429).json({error:'email_limit'});
 const k=req.ip,h=hits.get(k)||{t:Date.now(),n:0};if(Date.now()-h.t>3600000){h.t=Date.now();h.n=0}
 if(h.n>=5)return res.status(429).json({error:'rate_limited'});h.n++;hits.set(k,h);
 let country=null;try{const g=require('../geo').lookup(req);country=g&&g.country||null}catch(e){}
 const ua=String(req.headers['user-agent']||'').slice(0,300);
 await q('insert into contact_messages(name,email,topic,message,ip,lang,country,ua,page,files) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[name,email,topic,message,req.ip,lang,country,ua,page,files.length]);
 const when=new Date().toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' (МСК)';
 const body='Имя: '+(name||'не указано')+'\nПочта для ответа: '+email+'\nТема: '+TOPIC_RU[topic]+'\nЯзык сайта: '+LANG_RU[lang]+'\nСтрана по IP: '+(country||'не определена')+'\nIP: '+req.ip+'\nСтраница: '+(page||'-')+'\nБраузер: '+(ua||'-')+'\nВремя: '+when+'\nВложений: '+files.length+(files.length?' ('+files.map(f=>f.filename).join(', ')+')':'')+'\n\nСообщение:\n'+message;
 const subject=TOPIC_RU[topic]+' — '+(name||email);
 let boxRow=null;
 try{const [bx]=await q('select id,address,title,kind from org_mailboxes where kind=$1 order by created_at limit 1',[KIND[topic]]);boxRow=bx||null;
  if(!boxRow){const [sp]=await q("select id,address,title,kind from org_mailboxes where kind='support' order by created_at limit 1");boxRow=sp||null}
  if(boxRow)await OM.save(boxRow,{direction:'in',from:email,to:boxRow.address,subject,text:body},files)}
 catch(e){console.error('contact to mailbox failed',e.message)}
 const to=(process.env.CONTACT_TO||'').trim();
 if(to){try{await transport.sendMail({from:{name:'Geserd: форма связи',address:FROM},to,replyTo:{name:name||email,address:email},subject,text:body,attachments:files})}catch(e){console.error('contact mail failed',e.message)}}
 res.json({ok:true});
}));
const KORD=['support','enterprise','government','partnerships','legal','press','security','billing','advertising','careers','abuse','general','custom'];
r.get('/addresses',w(async(_q,res)=>{const rows=await q('select address,title,kind from org_mailboxes where show_public order by array_position($1::text[],kind),created_at',[KORD]);const seen=new Set();const items=rows.filter(x=>{if(x.kind==='custom')return true;if(seen.has(x.kind))return false;seen.add(x.kind);return true});res.set('Cache-Control','public,max-age=300').json({items})}));
module.exports=r;
