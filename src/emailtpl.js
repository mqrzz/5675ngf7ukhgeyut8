const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const SANS="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",SERIF="Georgia,'Times New Roman',serif",MONO="'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const FOOT={en:'Sent by Geserd',ru:'Письмо от Geserd',fr:'Envoyé par Geserd',de:'Gesendet von Geserd'};
const AUTO={en:'This is an automatic message. You can reply through Help in your account.',ru:'Это автоматическое письмо. Ответить можно через раздел «Помощь» в аккаунте.',fr:'Ceci est un message automatique. Vous pouvez répondre via l’aide de votre compte.',de:'Dies ist eine automatische Nachricht. Antworten können Sie über die Hilfe in Ihrem Konto.'};

function render(o){
 const lang=FOOT[o.lang]?o.lang:'en';
 const paras=(o.paras||[]).filter(Boolean);
 const text=o.heading+'\n\n'+(o.code?o.code+'\n\n':'')+paras.join('\n\n')+(o.cta?'\n\n'+o.cta.label+': '+o.cta.url:'')+(o.note?'\n\n'+o.note:'')+'\n\n-- \n'+'Sent with Geserd · '+APP;
 const body=paras.map(p=>'<p style="margin:0 0 14px;color:#9a9ea6;font:400 15px/1.65 '+SANS+';text-align:left;">'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
 const code=o.code?'<div style="margin:26px 0 24px;color:#ffffff;font:700 44px/1.1 '+MONO+';letter-spacing:.2em;">'+esc(o.code)+'</div>':'';
 const stats=(o.stats||[]).length?'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">'+o.stats.map(s=>'<tr><td style="padding:11px 0;border-bottom:1px solid #1f2226;color:#9a9ea6;font:400 14px/1.4 '+SANS+';">'+esc(s[0])+'</td><td align="right" style="padding:11px 0;border-bottom:1px solid #1f2226;color:#ffffff;font:600 15px/1.4 '+MONO+';">'+esc(s[1])+'</td></tr>').join('')+'</table>':'';
 const bar=o.percent!=null?'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="height:6px;border-radius:6px;background:#1d2024;font-size:0;line-height:0;"><table role="presentation" width="'+Math.max(2,Math.min(100,Math.round(o.percent)))+'%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;border-radius:6px;background:#ffffff;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>':'';
 const btn=o.cta?'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 0;"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:14px;"><a href="'+esc(o.cta.url)+'" style="display:inline-block;padding:13px 24px;color:#000000;font:600 15px/1 '+SANS+';text-decoration:none;">'+esc(o.cta.label)+'</a></td></tr></table>':'';
 const tag=o.tag?'<div style="margin:0 0 16px;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#141416;border:1px solid #2b2e33;color:#c9ccd1;font:500 12px/1 '+SANS+';">'+esc(o.tag)+'</span></div>':'';
 const html='<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>'+esc(o.heading)+'</title></head>'+
 '<body style="margin:0;padding:0;background:#000000;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000;">'+esc(o.pre||paras[0]||o.heading)+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000;"><tr><td align="center" style="padding:44px 16px 40px;">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">'+
 '<tr><td bgcolor="#0b0b0d" background="'+APP+'/assets/email/watermark.png" style="background:#0b0b0d url('+APP+'/assets/email/watermark.png) no-repeat right bottom;background-size:300px 300px;border:1px solid #26292d;border-radius:32px;padding:40px 36px 36px;">'+
 '<a href="'+APP+'" style="text-decoration:none;"><img src="cid:geserd-logo" width="128" alt="Geserd" style="display:block;border:0;outline:none;width:128px;height:auto;"></a>'+
 '<div style="height:64px;line-height:64px;font-size:0;">&nbsp;</div>'+tag+
 '<h1 style="margin:0 0 16px;color:#ffffff;font:400 36px/1.12 '+SERIF+';letter-spacing:-.6px;text-align:left;">'+esc(o.heading)+'</h1>'+body+code+bar+stats+btn+
 '<p style="margin:30px 0 0;color:#6f737a;font:400 12.5px/1.6 '+SANS+';max-width:380px;">'+esc(o.note||AUTO[lang])+'</p></td></tr>'+
 '<tr><td align="center" style="padding:30px 0 0;"><a href="'+APP+'" style="text-decoration:none;display:inline-block;"><img src="'+APP+'/assets/email/sent-with-light.png" width="190" height="81" alt="Sent with Geserd" style="display:inline-block;border:0;outline:none;width:190px;height:auto;"></a></td></tr>'+
 '</table></td></tr></table></body></html>';
 return{html,text};
}
module.exports={render,APP,esc};
