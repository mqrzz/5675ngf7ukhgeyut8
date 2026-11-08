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
 const t=L[lang]||L.en,m=require('./emailtpl').render({lang,heading:t.h,paras:[t.p],code,pre:t.pre.replace('{code}',code),note:t.exp+' '+t.ign});
 return{subject:t.subject.replace('{code}',code),text:m.text,html:m.html};
}
function sendCodeMail(to,code,lang){
 const m=codeMail(lang,code);
 return transport.sendMail({from:{name:'Geserd',address:FROM},to,subject:m.subject,text:m.text,html:m.html,attachments:[{filename:'geserd.png',path:path.join(__dirname,'..','assets','logo-mail.png'),cid:'geserd-logo',contentDisposition:'inline'}],headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}});
}
module.exports={transport,FROM,sendCodeMail,codeMail};
