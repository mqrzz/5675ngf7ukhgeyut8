const c=require('crypto');
const URL_PAY='https://auth.robokassa.ru/Merchant/Index.aspx';
const URL_REC='https://auth.robokassa.ru/Merchant/Recurring';
const ALG={md5:'md5',sha256:'sha256',sha384:'sha384',sha512:'sha512',ripemd160:'ripemd160'};
function env(){
 const e=process.env,test=e.ROBOKASSA_TEST==='1';
 return{login:e.ROBOKASSA_LOGIN||'',pass1:test?(e.ROBOKASSA_TEST_PASS1||''):(e.ROBOKASSA_PASS1||''),pass2:test?(e.ROBOKASSA_TEST_PASS2||''):(e.ROBOKASSA_PASS2||''),test,alg:ALG[String(e.ROBOKASSA_HASH||'md5').toLowerCase()]||'md5',receipt:e.ROBOKASSA_RECEIPT==='1',sno:e.ROBOKASSA_SNO||'usn_income'}
}
function configured(){const x=env();return!!(x.login&&x.pass1&&x.pass2)}
function hash(s){return c.createHash(env().alg).update(s,'utf8').digest('hex')}
function money(n){return Number(n).toFixed(2)}
function shpPart(shp){return Object.keys(shp||{}).sort().map(k=>k+'='+shp[k]).join(':')}
function sign(parts,shp){const sp=shpPart(shp);return hash(parts.join(':')+(sp?':'+sp:''))}
function eq(a,b){a=Buffer.from(String(a||'').toLowerCase());b=Buffer.from(String(b||'').toLowerCase());return a.length===b.length&&c.timingSafeEqual(a,b)}
function receipt(inv,title){
 const x=env();if(!x.receipt)return null;
 return{sno:x.sno,items:[{name:String(title).slice(0,128),quantity:1,sum:Number(money(inv.amount)),payment_method:'full_payment',payment_object:'service',tax:'none'}]}
}
function shpOf(q){const o={};for(const k of Object.keys(q||{}))if(/^shp_/i.test(k))o[k]=String(q[k]);return o}
function paymentUrl(inv,opts){
 const x=env();if(!configured())throw Object.assign(new Error('provider_not_configured'),{code:'provider_not_configured'});
 const out=money(inv.amount),shp=opts.shp||{},rc=receipt(inv,opts.description);
 const rcEnc=rc?encodeURIComponent(JSON.stringify(rc)):null;
 const parts=[x.login,out,String(inv.id)];if(rcEnc)parts.push(rcEnc);parts.push(x.pass1);
 const u=new URL(URL_PAY);
 u.searchParams.set('MerchantLogin',x.login);u.searchParams.set('OutSum',out);u.searchParams.set('InvId',String(inv.id));
 u.searchParams.set('Description',String(opts.description).slice(0,100));
 if(rcEnc)u.searchParams.set('Receipt',rcEnc);
 if(opts.recurring)u.searchParams.set('Recurring','true');
 if(opts.email)u.searchParams.set('Email',opts.email);
 u.searchParams.set('Culture',opts.culture==='ru'?'ru':'en');
 for(const[k,v]of Object.entries(shp))u.searchParams.set(k,v);
 if(x.test)u.searchParams.set('IsTest','1');
 u.searchParams.set('SignatureValue',sign(parts,shp));
 return u.toString()
}
function verifyResult(q){
 const x=env();if(!configured())return{ok:false,reason:'not_configured'};
 const out=String(q.OutSum||''),id=String(q.InvId||'');
 if(!/^\d+$/.test(id)||!/^\d+(\.\d+)?$/.test(out))return{ok:false,reason:'bad_params'};
 const want=sign([out,id,x.pass2],shpOf(q));
 return eq(want,q.SignatureValue)?{ok:true,invId:Number(id),outSum:Number(out),shp:shpOf(q)}:{ok:false,reason:'bad_signature'}
}
function verifySuccess(q){
 const x=env();if(!configured())return{ok:false};
 const out=String(q.OutSum||''),id=String(q.InvId||'');
 if(!/^\d+$/.test(id)||!/^\d+(\.\d+)?$/.test(out))return{ok:false};
 return{ok:eq(sign([out,id,x.pass1],shpOf(q)),q.SignatureValue),invId:Number(id)}
}
async function charge(inv,parentId,description){
 const x=env();if(!configured())throw Object.assign(new Error('provider_not_configured'),{code:'provider_not_configured'});
 const out=money(inv.amount),rc=receipt(inv,description),rcEnc=rc?encodeURIComponent(JSON.stringify(rc)):null;
 const parts=[x.login,out,String(inv.id)];if(rcEnc)parts.push(rcEnc);parts.push(x.pass1);
 const body=new URLSearchParams({MerchantLogin:x.login,InvoiceID:String(inv.id),PreviousInvoiceID:String(parentId),Description:String(description).slice(0,100),SignatureValue:hash(parts.join(':')),OutSum:out});
 if(rcEnc)body.set('Receipt',rcEnc);
 if(x.test)body.set('IsTest','1');
 const r=await fetch(URL_REC,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)});
 const text=(await r.text()).trim();
 return{ok:r.ok&&/^OK/i.test(text),text:text.slice(0,200)}
}
module.exports={name:'robokassa',configured,paymentUrl,verifyResult,verifySuccess,charge,sign,shpOf,money,env};
