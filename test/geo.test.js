const express=require('express');
const GEO=require('../src/geo');
const app=express();app.set('trust proxy',1);
app.get('/api/geo/check',GEO.check);app.get('/api/geo',GEO.info);app.use('/api',GEO.enforce);
app.get('/api/health',(_,r)=>r.json({ok:1}));app.get('/api/emails',(_,r)=>r.json({ok:1}));app.post('/api/billing/robokassa/result',(_,r)=>r.send('ok'));
const s=app.listen(3999,async()=>{
 const f=async(path,xff,m='GET')=>{const r=await fetch('http://127.0.0.1:3999'+path,{method:m,headers:xff?{'X-Forwarded-For':xff}:{}});return r.status+' '+(await r.text()).slice(0,90)};
 for(const [ip,n] of [['49.36.10.1','IN'],['5.255.255.77','RU'],['89.160.20.112','SE'],['8.8.8.8','US']]){
  console.log(n,ip,'| check',await f('/api/geo/check',ip),'| api',await f('/api/emails',ip))}
 console.log('info probe',await f('/api/geo?ip=49.36.10.1'));
 console.log('spoof xff (client sends fake, nginx appends real last):',await f('/api/emails','8.8.8.8, 49.36.10.1'));
 console.log('health blocked ip',await f('/api/health','49.36.10.1'));
 console.log('robokassa blocked ip',await f('/api/billing/robokassa/result','49.36.10.1','POST'));
 console.log('info blocked ip header',await f('/api/geo','49.36.10.1'));
 s.close()});
