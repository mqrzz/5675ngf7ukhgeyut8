const r=require('express').Router();const {q}=require('../db');const {w}=require('../auth');const {transport,FROM}=require('../mailer');
const TOPICS=['general','sales','security','abuse'];const EMAIL_RX=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hits=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of hits)if(n-v.t>3600000)hits.delete(k)},600000).unref();
r.post('/',w(async(req,res)=>{
 const b=req.body||{};
 if(b.website)return res.json({ok:true});
 const name=String(b.name||'').replace(/[\r\n]/g,' ').trim().slice(0,80),email=String(b.email||'').trim().toLowerCase().slice(0,254),topic=TOPICS.includes(b.topic)?b.topic:'general',message=String(b.message||'').trim().slice(0,5000);
 if(!EMAIL_RX.test(email))return res.status(400).json({error:'invalid_email'});
 if(message.length<10)return res.status(400).json({error:'message_too_short'});
 const k=req.ip,h=hits.get(k)||{t:Date.now(),n:0};if(Date.now()-h.t>3600000){h.t=Date.now();h.n=0}
 if(h.n>=5)return res.status(429).json({error:'rate_limited'});h.n++;hits.set(k,h);
 await q('insert into contact_messages(name,email,topic,message,ip) values($1,$2,$3,$4,$5)',[name,email,topic,message,req.ip]);
 const to=(process.env.CONTACT_TO||'').trim();
 if(to){try{await transport.sendMail({from:{name:'Geserd contact form',address:FROM},to,replyTo:{name:name||email,address:email},subject:'['+topic+'] '+(name||email),text:'From: '+(name||'-')+' <'+email+'>\nTopic: '+topic+'\nIP: '+req.ip+'\n\n'+message})}catch(e){console.error('contact mail failed',e.message)}}
 res.json({ok:true});
}));
module.exports=r;
