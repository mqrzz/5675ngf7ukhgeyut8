// AES-256-GCM for secrets at rest (DKIM private keys). SECRET_KEY = 64 hex chars.
const c=require('crypto');const k=()=>Buffer.from(process.env.SECRET_KEY,'hex');
exports.enc=t=>{const iv=c.randomBytes(12),x=c.createCipheriv('aes-256-gcm',k(),iv),d=Buffer.concat([x.update(t,'utf8'),x.final()]);return Buffer.concat([iv,x.getAuthTag(),d]).toString('base64')};
exports.dec=s=>{const b=Buffer.from(s,'base64'),x=c.createDecipheriv('aes-256-gcm',k(),b.subarray(0,12));x.setAuthTag(b.subarray(12,28));return Buffer.concat([x.update(b.subarray(28)),x.final()]).toString('utf8')};
