const path=require('path');const {transport,FROM}=require('./mailer');
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const SANS="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",SERIF="Georgia,'Times New Roman',serif";
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const {render}=require('./emailtpl');
async function send(to,o){
 const m=render(o);
 return transport.sendMail({from:{name:'Geserd',address:FROM},to,subject:o.subject||o.heading,text:m.text,html:m.html,attachments:[{filename:'geserd.png',path:path.join(__dirname,'..','assets','logo-mail.png'),cid:'geserd-logo',contentDisposition:'inline'}],headers:{'Auto-Submitted':'auto-generated'}});
}
module.exports={render,send,APP};
