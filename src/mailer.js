const nodemailer=require('nodemailer');
const transport=nodemailer.createTransport({sendmail:true,newline:'unix',path:'/usr/sbin/sendmail'});
const FROM=process.env.FROM_EMAIL||('noreply@'+(process.env.MAIL_HOST||'localhost'));
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const L={
 en:{subject:'{code} is your Geserd sign-in code',pre:'Your sign-in code is {code}. It expires in 10 minutes.',h:'Your sign-in code',p:'Enter this code on the Geserd sign-in page to continue.',exp:'The code expires in 10 minutes and can be used once.',ign:'If you did not request this, you can safely ignore this email. Nobody can access your account without the code.',foot:'Sent by Geserd'},
 ru:{subject:'{code} — ваш код для входа в Geserd',pre:'Ваш код для входа: {code}. Он действует 10 минут.',h:'Ваш код для входа',p:'Введите этот код на странице входа Geserd, чтобы продолжить.',exp:'Код действует 10 минут и может быть использован один раз.',ign:'Если вы не запрашивали код, просто проигнорируйте это письмо. Без кода никто не получит доступ к вашему аккаунту.',foot:'Отправлено сервисом Geserd'},
 fr:{subject:'{code} est votre code de connexion Geserd',pre:'Votre code de connexion est {code}. Il expire dans 10 minutes.',h:'Votre code de connexion',p:'Saisissez ce code sur la page de connexion de Geserd pour continuer.',exp:'Le code expire dans 10 minutes et ne peut être utilisé qu’une fois.',ign:'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail. Personne ne peut accéder à votre compte sans le code.',foot:'Envoyé par Geserd'},
 de:{subject:'{code} ist Ihr Geserd-Anmeldecode',pre:'Ihr Anmeldecode lautet {code}. Er läuft in 10 Minuten ab.',h:'Ihr Anmeldecode',p:'Geben Sie diesen Code auf der Geserd-Anmeldeseite ein, um fortzufahren.',exp:'Der Code ist 10 Minuten gültig und nur einmal verwendbar.',ign:'Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach. Ohne den Code kann niemand auf Ihr Konto zugreifen.',foot:'Gesendet von Geserd'}
};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const path=require('path');
const SANS="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",SERIF="Georgia,'Times New Roman',serif",MONO="'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
function codeMail(lang,code){
 const t=L[lang]||L.en,sp=code.split('').join('&#8202;'),host=APP.replace(/^https?:\/\//,'');
 const text=t.h+'\n\n'+code+'\n\n'+t.p+'\n'+t.exp+'\n\n'+t.ign+'\n\n-- \n'+t.foot+' · '+APP;
 const digits=code.split('').map(d=>'<td align="center" width="48" style="width:48px;height:64px;border-radius:16px;background:#141416;border:1px solid #2b2e33;color:#ffffff;font:600 30px/64px '+MONO+';">'+d+'</td>').join('<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>');
 const html='<!doctype html><html lang="'+(L[lang]?lang:'en')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>'+esc(t.h)+'</title></head>'+
 '<body style="margin:0;padding:0;background:#000000;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000;">'+esc(t.pre.replace('{code}',code))+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000;"><tr><td align="center" style="padding:48px 16px 40px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">'+
 '<tr><td align="center" style="padding:0 0 32px;"><a href="'+APP+'" style="text-decoration:none;"><img src="cid:geserd-logo" width="132" alt="Geserd" style="display:block;border:0;outline:none;width:132px;height:auto;"></a></td></tr>'+
 '<tr><td bgcolor="#0b0b0d" style="background:#0b0b0d;background-image:linear-gradient(180deg,#17171a 0%,#0b0b0d 38%);border:1px solid #26292d;border-radius:28px;padding:44px 32px 40px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'+
 '<h1 style="margin:0 0 12px;color:#ffffff;font:400 30px/1.2 '+SERIF+';letter-spacing:-.5px;text-align:center;">'+esc(t.h)+'</h1>'+
 '<p style="margin:0 0 32px;color:#b0b4ba;font:400 15px/1.6 '+SANS+';text-align:center;">'+esc(t.p)+'</p>'+
 '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>'+digits+'</tr></table>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0 0;"><tr><td align="center" style="padding:14px 18px;border-radius:16px;background:#141416;color:#c9ccd1;font:500 13.5px/1.5 '+SANS+';">'+esc(t.exp)+'</td></tr></table>'+
 '<p style="margin:28px 0 0;padding-top:24px;border-top:1px solid #1f2226;color:#7b7f86;font:400 13px/1.6 '+SANS+';text-align:center;">'+esc(t.ign)+'</p>'+
 '</td></tr></table></td></tr>'+
 '<tr><td align="center" style="padding:28px 0 0;color:#5d6168;font:400 12px/1.6 '+SANS+';">'+esc(t.foot)+' &middot; <a href="'+APP+'" style="color:#8b8f96;text-decoration:underline;">'+host+'</a></td></tr>'+
 '</table></td></tr></table></body></html>';
 return{subject:t.subject.replace('{code}',code),text,html};
}
function sendCodeMail(to,code,lang){
 const m=codeMail(lang,code);
 return transport.sendMail({from:{name:'Geserd',address:FROM},to,subject:m.subject,text:m.text,html:m.html,attachments:[{filename:'geserd.png',path:path.join(__dirname,'..','assets','logo-mail.png'),cid:'geserd-logo',contentDisposition:'inline'}],headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}});
}
module.exports={transport,FROM,sendCodeMail,codeMail};
