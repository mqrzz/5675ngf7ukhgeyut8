const c=require('crypto');
const BASE=process.env.PUBLIC_URL||('https://'+(process.env.BASE_DOMAIN||'geserd.com'));
const key=()=>Buffer.from(process.env.SECRET_KEY,'hex');
const sig=s=>c.createHmac('sha256',key()).update('unsub:'+s).digest('base64url').slice(0,22);
function tokenAddr(uid,email){const p=Buffer.from(uid+'|'+String(email).toLowerCase()).toString('base64url');return'x_'+p+'.'+sig('x_'+p)}
function verifyAddr(t){
 const m=/^x_([A-Za-z0-9_-]{20,500})\.([A-Za-z0-9_-]{22})$/.exec(String(t||''));if(!m)return null;
 const want=Buffer.from(sig('x_'+m[1])),got=Buffer.from(m[2]);
 if(want.length!==got.length||!c.timingSafeEqual(want,got))return null;
 const s=Buffer.from(m[1],'base64url').toString(),i=s.indexOf('|');
 if(i!==36)return null;
 return{uid:s.slice(0,i),email:s.slice(i+1)}}
const oneClick=t=>BASE+'/api/unsubscribe/'+t;
const page=t=>BASE+'/unsubscribe/?t='+t;
const has=(h,k)=>Object.keys(h||{}).some(x=>x.toLowerCase()===k);
function footer(url,html){
 if(html)return'<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;font:12px/1.5 Arial,Helvetica,sans-serif;color:#8a8a8a;">You are receiving this email because you subscribed. <a href="'+url+'" style="color:#8a8a8a;">Unsubscribe</a></div>';
 return'\n\n--\nYou are receiving this email because you subscribed.\nUnsubscribe: '+url}
const SIGNED='From:Sender:Reply-To:Subject:Date:Message-ID:To:Cc:MIME-Version:Content-Type:Content-Transfer-Encoding:In-Reply-To:References:List-Id:List-Help:List-Unsubscribe:List-Unsubscribe-Post:List-Subscribe:List-Post:List-Owner:List-Archive';
module.exports={tokenAddr,verifyAddr,oneClick,page,has,footer,SIGNED};
