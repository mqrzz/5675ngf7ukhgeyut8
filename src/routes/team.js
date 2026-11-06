const r=require('express').Router();const c=require('crypto');const {q}=require('../db');const {w,need,sessionOnly,sha}=require('../auth');const {transport,FROM}=require('../mailer');
const APP=(process.env.APP_URL||'https://geserd.com').replace(/\/$/,'');
const ROLES=['admin','member'];const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;const ID=/^[0-9a-f-]{36}$/i;
r.use(need,sessionOnly);
const MSG={en:['You are invited to a Geserd workspace','{n} invited you to join their Geserd workspace as {r}.','Accept the invitation','The link is valid for 7 days. If you did not expect this, ignore this email.'],ru:['Вас приглашают в рабочее пространство Geserd','{n} приглашает вас в своё рабочее пространство Geserd с ролью «{r}».','Принять приглашение','Ссылка действует 7 дней. Если вы не ждали это письмо, просто проигнорируйте его.'],fr:['Vous êtes invité dans un espace de travail Geserd','{n} vous invite à rejoindre son espace de travail Geserd avec le rôle « {r} ».','Accepter l’invitation','Le lien est valable 7 jours. Si vous ne l’attendiez pas, ignorez cet e-mail.'],de:['Sie wurden zu einem Geserd-Arbeitsbereich eingeladen','{n} lädt Sie mit der Rolle „{r}“ in seinen Geserd-Arbeitsbereich ein.','Einladung annehmen','Der Link ist 7 Tage gültig. Wenn Sie das nicht erwartet haben, ignorieren Sie diese E-Mail.']};
const RN={en:{admin:'Admin',member:'Member'},ru:{admin:'Администратор',member:'Участник'},fr:{admin:'Administrateur',member:'Membre'},de:{admin:'Administrator',member:'Mitglied'}};
r.get('/',w(async(req,res)=>{
 const [me]=await q('select name,email from users where id=$1',[req.user.id]);
 const members=await q('select m.user_id id,u.name,u.email,m.role,m.created_at from team_members m join users u on u.id=m.user_id where m.owner_id=$1 order by m.created_at',[req.user.id]);
 const invites=await q('select id,email,role,created_at,expires_at from team_invites where owner_id=$1 and accepted_at is null and revoked_at is null and expires_at>now() order by created_at desc',[req.user.id]);
 const joined=await q('select m.owner_id id,u.name,u.email,m.role from team_members m join users u on u.id=m.owner_id where m.user_id=$1',[req.user.id]);
 res.json({owner:me,members,invites,joined,roles:ROLES})}));
r.post('/invites',w(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),role=ROLES.includes(req.body.role)?req.body.role:'member';
 if(!EMAIL.test(email)||email.length>254)return res.status(400).json({error:'invalid_email'});
 const [me]=await q('select name,email,lang from users where id=$1',[req.user.id]);
 if(me.email.toLowerCase()===email)return res.status(400).json({error:'self_invite'});
 const n=(await q('select count(*)::int n from team_invites where owner_id=$1 and accepted_at is null and revoked_at is null and expires_at>now()',[req.user.id]))[0].n;
 const m=(await q('select count(*)::int n from team_members where owner_id=$1',[req.user.id]))[0].n;
 if(n+m>=20)return res.status(403).json({error:'team_limit'});
 if((await q('select 1 from team_members m join users u on u.id=m.user_id where m.owner_id=$1 and lower(u.email)=$2',[req.user.id,email])).length)return res.status(409).json({error:'already_member'});
 await q("update team_invites set revoked_at=now() where owner_id=$1 and email=$2 and accepted_at is null and revoked_at is null",[req.user.id,email]);
 const token=c.randomBytes(24).toString('base64url');
 const [row]=await q('insert into team_invites(owner_id,email,role,token_hash) values($1,$2,$3,$4) returning id,email,role,created_at,expires_at',[req.user.id,email,role,sha(token)]);
 const L=MSG[me.lang]?me.lang:'en',M=MSG[L],link=APP+'/app/settings/team/?invite='+token,who=me.name||me.email;
 try{await transport.sendMail({from:{name:'Geserd',address:FROM},to:email,subject:M[0],text:M[1].replace('{n}',who).replace('{r}',RN[L][role])+'\n\n'+M[2]+': '+link+'\n\n'+M[3],html:'<p>'+M[1].replace('{n}',who.replace(/[<>&]/g,'')).replace('{r}',RN[L][role])+'</p><p><a href="'+link+'">'+M[2]+'</a></p><p style="color:#666">'+M[3]+'</p>'})}
 catch(e){console.error('team invite mail failed',e.message);await q('update team_invites set revoked_at=now() where id=$1',[row.id]);return res.status(502).json({error:'send_failed'})}
 res.status(201).json(row)}));
r.delete('/invites/:id',w(async(req,res)=>{if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});await q('update team_invites set revoked_at=now() where id=$1 and owner_id=$2 and accepted_at is null',[req.params.id,req.user.id]);res.json({ok:true})}));
r.delete('/members/:id',w(async(req,res)=>{if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});await q('delete from team_members where owner_id=$1 and user_id=$2',[req.user.id,req.params.id]);res.json({ok:true})}));
r.post('/leave/:id',w(async(req,res)=>{if(!ID.test(req.params.id))return res.status(404).json({error:'not_found'});await q('delete from team_members where owner_id=$1 and user_id=$2',[req.params.id,req.user.id]);res.json({ok:true})}));
r.get('/invite/:token',w(async(req,res)=>{
 const [i]=await q('select i.id,i.email,i.role,u.name owner_name,u.email owner_email from team_invites i join users u on u.id=i.owner_id where i.token_hash=$1 and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()',[sha(req.params.token)]);
 if(!i)return res.status(404).json({error:'invite_invalid'});
 const [me]=await q('select email from users where id=$1',[req.user.id]);
 res.json({role:i.role,owner_name:i.owner_name||i.owner_email,email_match:me.email.toLowerCase()===i.email,invited_email:i.email})}));
r.post('/accept',w(async(req,res)=>{
 const [i]=await q('select i.id,i.owner_id,i.email,i.role from team_invites i where i.token_hash=$1 and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()',[sha(String(req.body.token||''))]);
 if(!i)return res.status(404).json({error:'invite_invalid'});
 const [me]=await q('select email from users where id=$1',[req.user.id]);
 if(me.email.toLowerCase()!==i.email)return res.status(403).json({error:'invite_email_mismatch'});
 if(i.owner_id===req.user.id)return res.status(400).json({error:'self_invite'});
 await q('insert into team_members(owner_id,user_id,role) values($1,$2,$3) on conflict(owner_id,user_id) do update set role=excluded.role',[i.owner_id,req.user.id,i.role]);
 await q('update team_invites set accepted_at=now() where id=$1',[i.id]);res.json({ok:true})}));
module.exports=r;
