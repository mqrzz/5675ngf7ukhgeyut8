// Outgoing mail: the shared sendmail transport (Postfix) and the branded sign-in code email (HTML + plain-text alternative, 4 languages).
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
function codeMail(lang,code){
 const t=L[lang]||L.en,sp=code.slice(0,3)+' '+code.slice(3);
 const text=t.h+'\n\n'+code+'\n\n'+t.p+'\n'+t.exp+'\n\n'+t.ign+'\n\n-- \n'+t.foot+' · '+APP;
 const html='<!doctype html><html lang="'+(L[lang]?lang:'en')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>'+esc(t.h)+'</title></head>'+
 '<body style="margin:0;padding:0;background:#000000;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000;">'+esc(t.pre.replace('{code}',code))+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;"><tr><td align="center" style="padding:40px 16px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">'+
 '<tr><td align="center" style="padding:0 0 28px;"><a href="'+APP+'" style="text-decoration:none;"><span style="display:inline-block;width:48px;height:48px;line-height:46px;border:1px solid #2a2d31;border-radius:14px;background:#0b0b0c;color:#f2f2f2;font:600 28px Georgia,\'Times New Roman\',serif;text-align:center;">G</span><br><span style="display:inline-block;margin-top:12px;color:#f2f2f2;font:600 20px Georgia,\'Times New Roman\',serif;letter-spacing:.2px;">Geserd</span></a></td></tr>'+
 '<tr><td style="background:#0b0b0c;border:1px solid #26292d;border-radius:20px;padding:36px 32px;">'+
 '<h1 style="margin:0 0 12px;color:#ffffff;font:400 26px/1.25 Georgia,\'Times New Roman\',serif;text-align:center;">'+esc(t.h)+'</h1>'+
 '<p style="margin:0 0 24px;color:#b0b4ba;font:400 15px/1.6 -apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;text-align:center;">'+esc(t.p)+'</p>'+
 '<div style="margin:0 auto 24px;padding:18px 12px;border:1px solid #33373c;border-radius:14px;background:#000000;text-align:center;"><span style="color:#ffffff;font:600 34px/1 \'SFMono-Regular\',Menlo,Consolas,\'Liberation Mono\',monospace;letter-spacing:8px;">'+sp+'</span></div>'+
 '<p style="margin:0 0 6px;color:#b0b4ba;font:400 13.5px/1.6 -apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;text-align:center;">'+esc(t.exp)+'</p>'+
 '<p style="margin:0;color:#7b7f86;font:400 13px/1.6 -apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;text-align:center;">'+esc(t.ign)+'</p></td></tr>'+
 '<tr><td align="center" style="padding:24px 0 0;color:#5d6168;font:400 12px/1.5 -apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'+esc(t.foot)+' · <a href="'+APP+'" style="color:#7b7f86;text-decoration:underline;">'+APP.replace(/^https?:\/\//,'')+'</a></td></tr>'+
 '</table></td></tr></table></body></html>';
 return{subject:t.subject.replace('{code}',code),text,html};
}
function sendCodeMail(to,code,lang){
 const m=codeMail(lang,code);
 return transport.sendMail({from:{name:'Geserd',address:FROM},to,subject:m.subject,text:m.text,html:m.html,headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}});
}
module.exports={transport,FROM,sendCodeMail,codeMail};
