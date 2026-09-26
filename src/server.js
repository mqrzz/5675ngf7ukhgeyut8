const express=require('express');const {q}=require('./db');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}));
app.get('/api/health',async(_,res)=>{try{await q('select 1');res.json({ok:true})}catch{res.status(503).json({ok:false})}});
app.use('/api/api-keys',require('./routes/keys'));
app.use('/api/domains',require('./routes/domains'));
app.use('/api',(_,res)=>res.status(404).json({error:'not_found'}));
app.use((e,_q,res,_n)=>{console.error(e);res.status(500).json({error:'server_error'})});
const port=process.env.PORT||3001;app.listen(port,'127.0.0.1',()=>console.log('geserd api on 127.0.0.1:'+port));
