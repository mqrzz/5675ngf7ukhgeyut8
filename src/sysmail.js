const {q}=require('./db');const BM=require('./brandmail');
const APP=BM.APP;
const L={
en:{welcome:{s:'Welcome to Geserd',h:'Welcome to Geserd',p:['Your account is ready. To send from your own domain, add and verify it first, then create an API key or use SMTP.','Until a domain is verified, you can send test messages to your own address.'],cta:'Add your domain',note:'Need help? Open Help in your account and write to us.'},
 q80:{s:'You have used 80% of your {scope} limit',h:'80% of your {scope} limit is used',p:['You have sent {used} of {limit} emails on your plan {scope}.','When the limit is reached, sending pauses until it resets or you upgrade.'],cta:'See usage',note:'You can turn these messages off in your notification settings.'},
 q100:{s:'You have reached your {scope} limit',h:'Your {scope} limit is reached',p:['You have used all {limit} emails on your plan {scope}. Sending is paused until the limit resets.','Upgrade your plan to continue right away.'],cta:'Choose a plan',note:'You can turn these messages off in your notification settings.'},
 monthly:{s:'Your Geserd month: {sent} emails',h:'Your month in numbers',p:['Here is how your sending went last month.'],rows:['Sent','Delivered','Bounced','Complaints'],cta:'Open metrics',note:'You get this summary once a month. You can turn it off in your notification settings.'},
 signin:{s:'New sign-in to your Geserd account',h:'New sign-in',p:['Your account was just signed in to from a new place: {where}.','If this was you, nothing to do. If not, sign out everywhere and contact support right away.'],cta:'Review your account',note:'This message is sent for your security.'},
 twofa_on:{s:'Two-factor authentication is on',h:'Two-factor authentication is on',p:['From now on, signing in needs a code from your authenticator app.','Keep your recovery codes in a safe place.'],cta:'Security settings',note:'If you did not do this, contact support right away.'},
 twofa_off:{s:'Two-factor authentication is off',h:'Two-factor authentication is off',p:['Your account no longer asks for a code from an authenticator app.','We recommend turning it back on.'],cta:'Security settings',note:'If you did not do this, contact support right away.'},
 scope:{monthly:'monthly',daily:'daily'}},
ru:{welcome:{s:'Добро пожаловать в Geserd',h:'Добро пожаловать в Geserd',p:['Аккаунт готов. Чтобы отправлять с собственного домена, сначала добавьте и подтвердите его, затем создайте API-ключ или используйте SMTP.','Пока домен не подтверждён, можно отправлять тестовые письма на ваш собственный адрес.'],cta:'Добавить домен',note:'Нужна помощь? Откройте «Помощь» в аккаунте и напишите нам.'},
 q80:{s:'Вы использовали 80% {scope} лимита',h:'Использовано 80% {scope} лимита',p:['Вы отправили {used} из {limit} писем по вашему тарифу {scope}.','Когда лимит закончится, отправка приостановится до его обновления или до смены тарифа.'],cta:'Посмотреть расход',note:'Эти письма можно отключить в настройках уведомлений.'},
 q100:{s:'Вы достигли {scope} лимита',h:'{scope} лимит исчерпан',p:['Вы использовали все {limit} писем по тарифу {scope}. Отправка приостановлена до обновления лимита.','Смените тариф, чтобы продолжить сразу.'],cta:'Выбрать тариф',note:'Эти письма можно отключить в настройках уведомлений.'},
 monthly:{s:'Ваш месяц в Geserd: {sent} писем',h:'Ваш месяц в цифрах',p:['Так прошла ваша отправка в прошлом месяце.'],rows:['Отправлено','Доставлено','Отказы','Жалобы'],cta:'Открыть метрики',note:'Такая сводка приходит раз в месяц. Её можно отключить в настройках уведомлений.'},
 signin:{s:'Новый вход в ваш аккаунт Geserd',h:'Новый вход',p:['В ваш аккаунт только что вошли с нового места: {where}.','Если это были вы, ничего делать не нужно. Если нет, завершите все сеансы и сразу напишите в поддержку.'],cta:'Проверить аккаунт',note:'Это письмо отправлено ради вашей безопасности.'},
 twofa_on:{s:'Двухфакторная аутентификация включена',h:'Двухфакторная аутентификация включена',p:['Теперь для входа нужен код из приложения-аутентификатора.','Храните резервные коды в надёжном месте.'],cta:'Настройки безопасности',note:'Если это сделали не вы, сразу напишите в поддержку.'},
 twofa_off:{s:'Двухфакторная аутентификация выключена',h:'Двухфакторная аутентификация выключена',p:['Аккаунт больше не запрашивает код из приложения-аутентификатора.','Рекомендуем включить её снова.'],cta:'Настройки безопасности',note:'Если это сделали не вы, сразу напишите в поддержку.'},
 scope:{monthly:'месячного',daily:'дневного'}},
fr:{welcome:{s:'Bienvenue sur Geserd',h:'Bienvenue sur Geserd',p:['Votre compte est prêt. Pour envoyer depuis votre propre domaine, ajoutez-le et vérifiez-le d’abord, puis créez une clé API ou utilisez SMTP.','Tant qu’aucun domaine n’est vérifié, vous pouvez envoyer des messages de test à votre propre adresse.'],cta:'Ajouter votre domaine',note:'Besoin d’aide ? Ouvrez Aide dans votre compte et écrivez-nous.'},
 q80:{s:'Vous avez utilisé 80 % de votre limite {scope}',h:'80 % de votre limite {scope} est utilisée',p:['Vous avez envoyé {used} e-mails sur {limit} avec votre offre {scope}.','Une fois la limite atteinte, l’envoi est suspendu jusqu’à sa réinitialisation ou jusqu’à un changement d’offre.'],cta:'Voir la consommation',note:'Vous pouvez désactiver ces messages dans vos paramètres de notification.'},
 q100:{s:'Vous avez atteint votre limite {scope}',h:'Votre limite {scope} est atteinte',p:['Vous avez utilisé les {limit} e-mails de votre offre {scope}. L’envoi est suspendu jusqu’à la réinitialisation.','Changez d’offre pour continuer tout de suite.'],cta:'Choisir une offre',note:'Vous pouvez désactiver ces messages dans vos paramètres de notification.'},
 monthly:{s:'Votre mois sur Geserd : {sent} e-mails',h:'Votre mois en chiffres',p:['Voici comment s’est passé votre envoi le mois dernier.'],rows:['Envoyés','Distribués','Rebonds','Plaintes'],cta:'Ouvrir les métriques',note:'Vous recevez ce récapitulatif une fois par mois. Vous pouvez le désactiver dans vos paramètres de notification.'},
 signin:{s:'Nouvelle connexion à votre compte Geserd',h:'Nouvelle connexion',p:['Votre compte vient d’être utilisé depuis un nouvel endroit : {where}.','Si c’était vous, rien à faire. Sinon, déconnectez toutes les sessions et contactez le support immédiatement.'],cta:'Vérifier votre compte',note:'Ce message est envoyé pour votre sécurité.'},
 twofa_on:{s:'L’authentification à deux facteurs est activée',h:'Authentification à deux facteurs activée',p:['Désormais, la connexion demande un code de votre application d’authentification.','Conservez vos codes de récupération en lieu sûr.'],cta:'Paramètres de sécurité',note:'Si ce n’est pas vous, contactez le support immédiatement.'},
 twofa_off:{s:'L’authentification à deux facteurs est désactivée',h:'Authentification à deux facteurs désactivée',p:['Votre compte ne demande plus de code d’une application d’authentification.','Nous recommandons de la réactiver.'],cta:'Paramètres de sécurité',note:'Si ce n’est pas vous, contactez le support immédiatement.'},
 scope:{monthly:'mensuelle',daily:'quotidienne'}},
de:{welcome:{s:'Willkommen bei Geserd',h:'Willkommen bei Geserd',p:['Ihr Konto ist bereit. Um von Ihrer eigenen Domain zu senden, fügen Sie sie zuerst hinzu und verifizieren Sie sie, erstellen Sie dann einen API-Schlüssel oder nutzen Sie SMTP.','Solange keine Domain verifiziert ist, können Sie Testnachrichten an Ihre eigene Adresse senden.'],cta:'Domain hinzufügen',note:'Brauchen Sie Hilfe? Öffnen Sie Hilfe in Ihrem Konto und schreiben Sie uns.'},
 q80:{s:'Sie haben 80 % Ihres {scope} Limits verbraucht',h:'80 % Ihres {scope} Limits sind verbraucht',p:['Sie haben {used} von {limit} E-Mails Ihres Tarifs {scope} gesendet.','Ist das Limit erreicht, pausiert der Versand bis zum Zurücksetzen oder bis zum Tarifwechsel.'],cta:'Verbrauch ansehen',note:'Sie können diese Nachrichten in den Benachrichtigungseinstellungen abschalten.'},
 q100:{s:'Sie haben Ihr {scope} Limit erreicht',h:'Ihr {scope} Limit ist erreicht',p:['Sie haben alle {limit} E-Mails Ihres Tarifs {scope} verbraucht. Der Versand pausiert bis zum Zurücksetzen.','Wechseln Sie den Tarif, um sofort fortzufahren.'],cta:'Tarif wählen',note:'Sie können diese Nachrichten in den Benachrichtigungseinstellungen abschalten.'},
 monthly:{s:'Ihr Monat bei Geserd: {sent} E-Mails',h:'Ihr Monat in Zahlen',p:['So lief Ihr Versand im letzten Monat.'],rows:['Gesendet','Zugestellt','Bounces','Beschwerden'],cta:'Metriken öffnen',note:'Diese Zusammenfassung kommt einmal im Monat. Sie können sie in den Benachrichtigungseinstellungen abschalten.'},
 signin:{s:'Neue Anmeldung in Ihrem Geserd-Konto',h:'Neue Anmeldung',p:['Ihr Konto wurde gerade von einem neuen Ort aus genutzt: {where}.','Wenn Sie das waren, ist nichts zu tun. Wenn nicht, melden Sie alle Sitzungen ab und kontaktieren Sie sofort den Support.'],cta:'Konto prüfen',note:'Diese Nachricht wird zu Ihrer Sicherheit gesendet.'},
 twofa_on:{s:'Zwei-Faktor-Authentifizierung ist aktiv',h:'Zwei-Faktor-Authentifizierung aktiv',p:['Für die Anmeldung ist jetzt ein Code aus Ihrer Authenticator-App nötig.','Bewahren Sie Ihre Wiederherstellungscodes sicher auf.'],cta:'Sicherheitseinstellungen',note:'Wenn Sie das nicht waren, kontaktieren Sie sofort den Support.'},
 twofa_off:{s:'Zwei-Faktor-Authentifizierung ist aus',h:'Zwei-Faktor-Authentifizierung aus',p:['Ihr Konto fragt keinen Code einer Authenticator-App mehr ab.','Wir empfehlen, sie wieder zu aktivieren.'],cta:'Sicherheitseinstellungen',note:'Wenn Sie das nicht waren, kontaktieren Sie sofort den Support.'},
 scope:{monthly:'monatlichen',daily:'täglichen'}}};
const URL={welcome:'/app/domains/',q80:'/app/settings/usage/',q100:'/pricing/',monthly:'/app/metrics/',signin:'/app/settings/',twofa_on:'/app/settings/',twofa_off:'/app/settings/'};
const PREF={q80:'quota',q100:'quota',monthly:'monthly',signin:'security',twofa_on:'security',twofa_off:'security'};
const f=(s,d)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>d[k]!=null?d[k]:m);
async function toUser(uid,type,d){
 d=d||{};
 try{
  const [u]=await q('select email,lang,notify,status from users where id=$1',[uid]);
  if(!u||!u.email||(u.status&&u.status!=='active'))return false;
  const pref=PREF[type];if(pref&&(u.notify||{})[pref]===false)return false;
  const lang=L[u.lang]?u.lang:'en',T=L[lang][type];if(!T)return false;
  const sc=d.scope?L[lang].scope[d.scope]||d.scope:'';
  const v={...d,scope:sc};
  const o={lang,subject:f(T.s,v),heading:f(T.h,v),paras:T.p.map(x=>f(x,v)),cta:{label:T.cta,url:APP+URL[type]},note:T.note};
  if(type==='quota'||type==='q80'||type==='q100')o.percent=type==='q80'?80:100;
  if(type==='monthly')o.stats=T.rows.map((r,i)=>[r,String([d.sent,d.delivered,d.bounced,d.complained][i]||0)]);
  await BM.send(u.email,o);return true;
 }catch(e){console.error('sysmail',type,e&&e.message);return false}}
const welcome=uid=>toUser(uid,'welcome');
async function monthly(){
 const now=new Date(),key='monthly:'+now.toISOString().slice(0,7);
 if(now.getUTCDate()!==1||now.getUTCHours()<6)return 0;
 const got=await q("insert into mail_marks(k) values($1) on conflict do nothing returning k",[key]);if(!got.length)return 0;
 const from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)),to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
 const rows=await q("select e.user_id,count(*)::int sent,count(*) filter(where exists(select 1 from events v where v.email_id=e.id and v.type='delivered'))::int delivered,count(*) filter(where exists(select 1 from events v where v.email_id=e.id and v.type='bounced'))::int bounced,count(*) filter(where exists(select 1 from events v where v.email_id=e.id and v.type='complained'))::int complained from emails e where e.direction='out' and e.created_at>=$1 and e.created_at<$2 and e.user_id is not null group by e.user_id",[from,to]);
 let n=0;for(const r of rows){if(await toUser(r.user_id,'monthly',{sent:r.sent,delivered:r.delivered,bounced:r.bounced,complained:r.complained}))n++}
 return n}
function start(){setInterval(()=>{monthly().catch(e=>console.error('monthly',e.message))},3600000).unref()}
module.exports={toUser,welcome,monthly,start};
