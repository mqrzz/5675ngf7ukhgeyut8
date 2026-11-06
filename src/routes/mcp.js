const r=require('express').Router();
const {q}=require('../db');const {w,need}=require('../auth');
const {send,status}=require('../send');
const VERSION='2025-03-26';
const TOOLS=[
{name:'send_email',description:'Send an email from a verified domain of this Geserd account.',inputSchema:{type:'object',properties:{from:{type:'string',description:'Sender address on a verified domain'},to:{type:'array',items:{type:'string'},description:'Recipient addresses'},subject:{type:'string'},text:{type:'string'},html:{type:'string'},reply_to:{type:'string'}},required:['from','to','subject']}},
{name:'list_emails',description:'List recent emails, newest first.',inputSchema:{type:'object',properties:{direction:{type:'string',enum:['in','out']},status:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}}}},
{name:'get_email',description:'Read one email with its events.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
{name:'list_domains',description:'List sending domains and their verification status.',inputSchema:{type:'object',properties:{}}},
{name:'list_templates',description:'List saved email templates.',inputSchema:{type:'object',properties:{}}}
];
const text=o=>({content:[{type:'text',text:typeof o==='string'?o:JSON.stringify(o,null,2)}]});
const fail=m=>({isError:true,content:[{type:'text',text:m}]});
async function call(user,name,a){
 a=a||{};
 if(name==='send_email'){
  const body={from:a.from,to:a.to,subject:a.subject};
  for(const k of ['text','html','reply_to'])if(a[k])body[k]=a[k];
  try{return text(await send(user.id,body,user.keyId))}catch(e){if(e&&e.code)return fail(e.code+(e.extra?' '+JSON.stringify(e.extra):''));throw e}}
 if(name==='list_emails'){
  const lim=Math.min(50,Math.max(1,parseInt(a.limit,10)||10));const args=[user.id];let where='user_id=$1';
  if(a.direction==='in'||a.direction==='out'){args.push(a.direction);where+=' and direction=$'+args.length}
  if(a.status){args.push(String(a.status));where+=' and status=$'+args.length}
  return text(await q('select id,direction,from_addr,to_addrs,subject,status,created_at from emails where '+where+' order by created_at desc limit '+lim,args))}
 if(name==='get_email'){
  if(!/^[0-9a-f-]{36}$/i.test(String(a.id||'')))return fail('not_found');
  const [e]=await q('select id,direction,from_addr,to_addrs,subject,text_body,status,error,created_at from emails where id=$1 and user_id=$2',[a.id,user.id]);if(!e)return fail('not_found');
  const ev=await q('select type,created_at from events where email_id=$1 order by created_at,id',[e.id]);return text({...e,events:ev})}
 if(name==='list_domains')return text(await q('select name,status,created_at from domains where user_id=$1 order by created_at desc',[user.id]));
 if(name==='list_templates')return text(await q('select id,name,subject,updated_at from templates where user_id=$1 order by updated_at desc limit 100',[user.id]));
 return null}
r.options('/',(req,res)=>res.status(204).end());
r.get('/',(req,res)=>res.status(405).set('Allow','POST').json({error:'method_not_allowed'}));
r.post('/',need,w(async(req,res)=>{
 const m=req.body||{};const id=m.id===undefined?null:m.id;
 const ok=result=>res.json({jsonrpc:'2.0',id,result});
 const bad=(code,message)=>res.json({jsonrpc:'2.0',id,error:{code,message}});
 if(m.jsonrpc!=='2.0'||typeof m.method!=='string')return bad(-32600,'Invalid request');
 if(m.id===undefined)return res.status(202).end();
 if(m.method==='initialize')return ok({protocolVersion:VERSION,capabilities:{tools:{}},serverInfo:{name:'geserd',version:'1.0.0'},instructions:'Send and read email with the Geserd account that owns this API key.'});
 if(m.method==='ping')return ok({});
 if(m.method==='tools/list')return ok({tools:TOOLS});
 if(m.method==='tools/call'){
  const p=m.params||{};if(!TOOLS.some(t=>t.name===p.name))return bad(-32602,'Unknown tool');
  const out=await call(req.user,p.name,p.arguments);return ok(out)}
 return bad(-32601,'Method not found')}));
module.exports=r;
