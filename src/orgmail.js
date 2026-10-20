const {q}=require('./db');const {execFile}=require('child_process');
const BASE=(process.env.BASE_DOMAIN||'geserd.com').toLowerCase();
const BAD=/\.(exe|scr|bat|cmd|com|pif|vbs|vbe|js|jse|wsf|wsh|msi|msp|jar|ps1|lnk|hta|cpl|dll|reg|apk)$/i;
const MAX_ATT=10*1024*1024;
const box=async a=>{const [r]=await q('select id,address,title,kind from org_mailboxes where address=$1',[String(a).toLowerCase()]);return r||null};
function scan(buf){return new Promise(ok=>{const p=execFile('clamscan',['--no-summary','-'],{timeout:15000},(e)=>{if(e&&e.code===1)return ok(false);ok(true)});p.on('error',()=>ok(true));try{p.stdin.on('error',()=>{});p.stdin.end(buf)}catch{ok(true)}})}
async function allowed(name,buf){if(BAD.test(name||''))return false;if(buf.length>MAX_ATT)return false;return scan(buf)}
async function save(b,m,atts){
 const [r]=await q("insert into org_messages(mailbox_id,direction,from_addr,to_addrs,subject,text_body,html,message_id,in_reply_to,read_at,sent_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",[b.id,m.direction,m.from,m.to,String(m.subject||'').slice(0,998),m.text||null,m.html||null,m.message_id||null,m.in_reply_to||null,m.direction==='out'?new Date():null,m.sent_by||null]);
 let dropped=0;
 for(const a of atts||[]){const buf=Buffer.isBuffer(a.content)?a.content:Buffer.from(a.content||'');if(!(await allowed(a.filename,buf))){dropped++;continue}
  await q('insert into org_attachments(message_id,filename,content_type,size,data) values($1,$2,$3,$4,$5)',[r.id,String(a.filename||'file').slice(0,200),String(a.contentType||'application/octet-stream').slice(0,120),buf.length,buf])}
 return{id:r.id,dropped}}
async function receive(parsed,rcpts,from){
 const ids=[];
 for(const a of rcpts){const b=await box(a);if(!b)continue;
  const to=((parsed.to&&parsed.to.text)||a).slice(0,1000);
  const s=await save(b,{direction:'in',from:(from||'').toLowerCase(),to,subject:parsed.subject,text:parsed.text,html:parsed.html||null,message_id:parsed.messageId,in_reply_to:parsed.inReplyTo},parsed.attachments);ids.push(s.id)}
 return ids}
const DEFAULTS=[['support','Support','support'],['gov','Government requests','government'],['partners','Partnerships','partnerships']];
async function ensureDefaults(){
 try{const [m]=await q("insert into org_meta(key) values('defaults_v1') on conflict do nothing returning key");if(!m)return;
  for(const [l,t,k] of DEFAULTS){const a=l+'@'+BASE;await q('insert into org_mailboxes(address,title,kind,show_public) values($1,$2,$3,true) on conflict(address) do update set show_public=true',[a,t,k])}}
 catch(e){console.error('orgmail defaults',e.message)}}
module.exports={box,save,receive,ensureDefaults,BASE,MAX_ATT,allowed};
