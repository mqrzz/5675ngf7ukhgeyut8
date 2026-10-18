const c=require('crypto');
const b64u=b=>Buffer.from(b).toString('base64url');
const jparse=s=>JSON.parse(Buffer.from(s,'base64url').toString('utf8'));
exports.pkce=()=>{const verifier=b64u(c.randomBytes(32));return{verifier,challenge:b64u(c.createHash('sha256').update(verifier).digest())}};
exports.domainOf=email=>{const m=/^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(String(email||'').trim().toLowerCase());return m?m[1]:null};
exports.discover=async issuer=>{
 const base=String(issuer).replace(/\/+$/,'');
 const r=await fetch(base+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('discovery_failed');
 const d=await r.json();
 if(String(d.issuer).replace(/\/+$/,'')!==base)throw new Error('issuer_mismatch');
 for(const k of['authorization_endpoint','token_endpoint','jwks_uri'])if(typeof d[k]!=='string'||!d[k].startsWith('https://')&&!process.env.SSO_ALLOW_HTTP)throw new Error('bad_endpoint');
 return d};
exports.verifyIdToken=(token,jwks,o)=>{
 const parts=String(token||'').split('.');
 if(parts.length!==3)throw new Error('bad_token');
 const head=jparse(parts[0]),body=jparse(parts[1]);
 if(head.alg!=='RS256')throw new Error('bad_alg');
 const jwk=(jwks.keys||[]).find(k=>k.kid===head.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
 if(!jwk)throw new Error('unknown_key');
 const ok=c.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),c.createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));
 if(!ok)throw new Error('bad_signature');
 const now=Math.floor(Date.now()/1000);
 if(String(body.iss).replace(/\/+$/,'')!==String(o.issuer).replace(/\/+$/,''))throw new Error('bad_iss');
 const aud=Array.isArray(body.aud)?body.aud:[body.aud];
 if(!aud.includes(o.clientId))throw new Error('bad_aud');
 if(typeof body.exp!=='number'||body.exp<now-30)throw new Error('expired');
 if(body.nonce!==o.nonce)throw new Error('bad_nonce');
 return body};
