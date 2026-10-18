const path=require('path');const {transport,FROM}=require('./mailer');
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const SANS="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",SERIF="Georgia,'Times New Roman',serif";
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const FOOT={en:'Sent by Geserd',ru:'Письмо от Geserd',fr:'Envoyé par Geserd',de:'Gesendet von Geserd'};
const AUTO={en:'This is an automatic message. You can reply through Help in your account.',ru:'Это автоматическое письмо. Ответить можно через раздел «Помощь» в аккаунте.',fr:'Ceci est un message automatique. Vous pouvez répondre via l’aide de votre compte.',de:'Dies ist eine automatische Nachricht. Antworten können Sie über die Hilfe in Ihrem Konto.'};
function render(o){
 const lang=FOOT[o.lang]?o.lang:'en',host=APP.replace(/^https?:\/\//,'');
 const paras=(o.paras||[]).filter(Boolean);
 const text=o.heading+'\n\n'+paras.join('\n\n')+(o.cta?'\n\n'+o.cta.label+': '+o.cta.url:'')+'\n\n-- \n'+FOOT[lang]+' · '+APP;
 const body=paras.map(p=>'<p style="margin:0 0 16px;color:#b0b4ba;font:400 15px/1.65 '+SANS+';text-align:left;">'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
 const btn=o.cta?'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 0;"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:14px;"><a href="'+esc(o.cta.url)+'" style="display:inline-block;padding:13px 24px;color:#000000;font:600 14.5px/1 '+SANS+';text-decoration:none;border-radius:14px;">'+esc(o.cta.label)+'</a></td></tr></table>':'';
 const tag=o.tag?'<div style="margin:0 0 18px;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#141416;border:1px solid #2b2e33;color:#c9ccd1;font:500 12px/1 '+SANS+';">'+esc(o.tag)+'</span></div>':'';
 const html='<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>'+esc(o.heading)+'</title></head>'+
 '<body style="margin:0;padding:0;background:#000000;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000;">'+esc(o.pre||paras[0]||o.heading)+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000;"><tr><td align="center" style="padding:48px 16px 40px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">'+
 '<tr><td align="center" style="padding:0 0 32px;"><a href="'+APP+'" style="text-decoration:none;"><img src="cid:geserd-logo" width="132" alt="Geserd" style="display:block;border:0;outline:none;width:132px;height:auto;"></a></td></tr>'+
 '<tr><td bgcolor="#0b0b0d" style="background:#0b0b0d;background-image:linear-gradient(180deg,#17171a 0%,#0b0b0d 38%);border:1px solid #26292d;border-radius:28px;padding:40px 32px 36px;">'+tag+
 '<h1 style="margin:0 0 18px;color:#ffffff;font:400 28px/1.25 '+SERIF+';letter-spacing:-.4px;text-align:left;">'+esc(o.heading)+'</h1>'+body+btn+
 '<p style="margin:28px 0 0;padding-top:22px;border-top:1px solid #1f2226;color:#7b7f86;font:400 12.5px/1.6 '+SANS+';">'+esc(o.note||AUTO[lang])+'</p></td></tr>'+
 '<tr><td align="center" style="padding:28px 0 0;color:#5d6168;font:400 12px/1.6 '+SANS+';">'+esc(FOOT[lang])+' &middot; <a href="'+APP+'" style="color:#8b8f96;text-decoration:underline;">'+host+'</a></td></tr>'+
 '</table></td></tr></table></body></html>';
 return{html,text};
}
async function send(to,o){
 const m=render(o);
 return transport.sendMail({from:{name:'Geserd',address:FROM},to,subject:o.subject||o.heading,text:m.text,html:m.html,attachments:[{filename:'geserd.png',path:path.join(__dirname,'..','assets','logo-mail.png'),cid:'geserd-logo',contentDisposition:'inline'}],headers:{'Auto-Submitted':'auto-generated'}});
}
module.exports={render,send,APP};
