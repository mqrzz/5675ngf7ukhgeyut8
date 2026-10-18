const BM=require('./brandmail');
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const T={
 en:{frozen:{s:'Your Geserd account is paused',b:'Hello,\n\nWe paused sending on your Geserd account while we review it. You can still sign in. Please write to us from Help in your account or through {app}/contact/ and we will sort it out.'},blocked:{s:'Your Geserd account was blocked',b:'Hello,\n\nYour Geserd account was blocked. If you think this is a mistake, write to us through {app}/contact/ and explain the situation. A person will review it.'},active:{s:'Your Geserd account is active again',b:'Hello,\n\nYour Geserd account is active again and you can send email as usual.'}},
 ru:{frozen:{s:'Ваш аккаунт Geserd приостановлен',b:'Здравствуйте!\n\nМы приостановили отправку писем в вашем аккаунте Geserd на время проверки. Войти в аккаунт по-прежнему можно. Напишите нам из раздела «Помощь» в аккаунте или через {app}/contact/, и мы всё уладим.'},blocked:{s:'Ваш аккаунт Geserd заблокирован',b:'Здравствуйте!\n\nВаш аккаунт Geserd заблокирован. Если вы считаете, что это ошибка, напишите нам через {app}/contact/ и опишите ситуацию. Обращение рассмотрит человек.'},active:{s:'Ваш аккаунт Geserd снова активен',b:'Здравствуйте!\n\nВаш аккаунт Geserd снова активен, и вы можете отправлять письма как обычно.'}},
 fr:{frozen:{s:'Votre compte Geserd est suspendu',b:'Bonjour,\n\nNous avons suspendu l’envoi sur votre compte Geserd le temps de l’examiner. Vous pouvez toujours vous connecter. Écrivez-nous depuis l’aide de votre compte ou via {app}/contact/ et nous réglerons cela.'},blocked:{s:'Votre compte Geserd a été bloqué',b:'Bonjour,\n\nVotre compte Geserd a été bloqué. Si vous pensez qu’il s’agit d’une erreur, écrivez-nous via {app}/contact/ en expliquant la situation. Une personne examinera votre demande.'},active:{s:'Votre compte Geserd est de nouveau actif',b:'Bonjour,\n\nVotre compte Geserd est de nouveau actif et vous pouvez envoyer des e-mails comme d’habitude.'}},
 de:{frozen:{s:'Ihr Geserd-Konto ist pausiert',b:'Guten Tag,\n\nwir haben den Versand in Ihrem Geserd-Konto für die Dauer einer Prüfung pausiert. Sie können sich weiterhin anmelden. Schreiben Sie uns über die Hilfe in Ihrem Konto oder über {app}/contact/, dann klären wir das.'},blocked:{s:'Ihr Geserd-Konto wurde gesperrt',b:'Guten Tag,\n\nIhr Geserd-Konto wurde gesperrt. Wenn Sie das für einen Fehler halten, schreiben Sie uns über {app}/contact/ und schildern Sie die Lage. Eine Person prüft Ihren Fall.'},active:{s:'Ihr Geserd-Konto ist wieder aktiv',b:'Guten Tag,\n\nIhr Geserd-Konto ist wieder aktiv, und Sie können E-Mails wie gewohnt senden.'}}
};
const CTA={en:'Open Help',ru:'Открыть «Помощь»',fr:'Ouvrir l’aide',de:'Hilfe öffnen'};
async function send(user,kind){
 try{
  const lang=T[user.lang]?user.lang:'en',t=T[lang][kind];if(!t||!user.email)return false;
  const paras=t.b.replace(/\{app\}/g,APP).split(/\n\n+/).map(x=>x.trim()).filter(Boolean);
  if(/^(hello|здравствуйте|bonjour|guten tag)/i.test(paras[0]))paras.shift();
  await BM.send(user.email,{lang,subject:t.s,heading:t.s,paras,cta:{label:CTA[lang],url:APP+'/app/help/'}});
  return true
 }catch(e){console.error('account mail',e.message);return false}
}
module.exports={send};
