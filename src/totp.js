const c=require('crypto');
const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(buf){let bits=0,v=0,o='';for(const x of buf){v=(v<<8)|x;bits+=8;while(bits>=5){o+=A[(v>>>(bits-5))&31];bits-=5}}if(bits>0)o+=A[(v<<(5-bits))&31];return o}
function unb32(s){let bits=0,v=0;const o=[];for(const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g,'')){v=(v<<5)|A.indexOf(ch);bits+=5;if(bits>=8){o.push((v>>>(bits-8))&255);bits-=8}}return Buffer.from(o)}
function secret(){return b32(c.randomBytes(20))}
function hotp(sec,step){const k=unb32(sec),b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step));const h=c.createHmac('sha1',k).update(b).digest();const o=h[19]&15;const n=((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3];return String(n%1000000).padStart(6,'0')}
function step(t){return Math.floor((t||Date.now())/30000)}
function check(sec,code,after,t){
 code=String(code||'').replace(/\s/g,'');if(!/^\d{6}$/.test(code))return null;
 const s=step(t);
 for(const d of[0,-1,1]){const x=s+d;if(after!=null&&x<=Number(after))continue;const g=hotp(sec,x),a=Buffer.from(g),b=Buffer.from(code);if(a.length===b.length&&c.timingSafeEqual(a,b))return x}
 return null}
function url(sec,email){const iss='Geserd';return 'otpauth://totp/'+encodeURIComponent(iss+':'+email)+'?secret='+sec+'&issuer='+encodeURIComponent(iss)+'&algorithm=SHA1&digits=6&period=30'}
function recoveryCodes(n){const o=[];for(let i=0;i<(n||8);i++){const r=c.randomBytes(5).toString('hex');o.push(r.slice(0,5)+'-'+r.slice(5))}return o}
const norm=s=>String(s||'').toLowerCase().replace(/[^a-f0-9]/g,'');
const hashRec=s=>c.createHash('sha256').update(norm(s)).digest('hex');
module.exports={secret,check,url,hotp,step,b32,unb32,recoveryCodes,hashRec,norm};
