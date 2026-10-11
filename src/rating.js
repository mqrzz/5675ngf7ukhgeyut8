const {q}=require('./db');const M=require('./metrics');const CFG=require('../config/rating.json');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(v,full,zero)=>v<=full?1:v>=zero?0:1-(v-full)/(zero-full);
async function compute(uid){
 const F=CFG.factors;
 const[u]=await q('select name,email,region,onboarded_at,created_at,coalesce(rating_adjust,0)::int adjust from users where id=$1',[uid]);
 if(!u)return null;
 const out=[];
 const dd=F.deliverability.days;
 const[t]=await q("select coalesce(sum(sent),0)::int sent,coalesce(sum(delivered),0)::int delivered,coalesce(sum(bounced),0)::int bounced,coalesce(sum(complained),0)::int complained from metric_hours where user_id=$1 and hr>=now()-($2||' days')::interval",[uid,String(dd)]);
 const sc=M.score(t);
 const dMax=F.deliverability.max;
 out.push(sc===null?{id:'deliverability',max:dMax,points:Math.round(dMax*F.deliverability.pending_share),state:'pending',detail:{sent:t.sent,need:F.deliverability.min_sends}}:{id:'deliverability',max:dMax,points:Math.round(dMax*sc/100),state:sc>=90?'full':sc>0?'partial':'none',detail:{score:sc,sent:t.sent,rates:M.rates(t)}});
 const[dm]=await q("select count(*) filter(where status='verified')::int custom,(select count(*)::int from subdomains where user_id=$1) own from domains where user_id=$1",[uid]);
 const mx=F.domain.max;
 out.push(dm.custom>0?{id:'domain',max:mx,points:mx,state:'full',detail:{custom:dm.custom}}:dm.own>0?{id:'domain',max:mx,points:Math.round(mx*F.domain.subdomain_share),state:'partial',detail:{own:dm.own}}:{id:'domain',max:mx,points:0,state:'none',detail:{}});
 const age=Math.max(0,Math.floor((Date.now()-new Date(u.created_at).getTime())/86400000));
 const hm=F.history.max,hp=Math.round(hm*clamp(age/F.history.full_days,0,1));
 out.push({id:'history',max:hm,points:hp,state:hp>=hm?'full':hp>0?'partial':'none',detail:{days:age,full_days:F.history.full_days}});
 const C=F.conduct,cm=C.max;
 const bs=await q("select (stats->>'sent')::int sent,(stats->>'complained')::int complained,(stats->>'unsubscribed')::int unsub from broadcasts where user_id=$1 and stats is not null and coalesce((stats->>'sent')::int,0)>0 order by coalesce(started_at,created_at) desc limit $2",[uid,C.broadcasts]);
 const sent=bs.reduce((a,b)=>a+b.sent,0),cp=sent?bs.reduce((a,b)=>a+(b.complained||0),0)/sent*100:0,un=sent?bs.reduce((a,b)=>a+(b.unsub||0),0)/sent*100:0;
 const share=sent?Math.min(lerp(cp,C.complaint_full,C.complaint_zero),lerp(un,C.unsub_full,C.unsub_zero)):1;
 const cpts=Math.round(cm*share);
 out.push({id:'conduct',max:cm,points:cpts,state:cpts>=cm?'full':cpts>0?'partial':'none',detail:{broadcasts:bs.length,sent,complaint_rate:Math.round(cp*100)/100,unsubscribe_rate:Math.round(un*100)/100}});
 const pm=F.profile.max,parts=[!!(u.name&&u.name.trim()),!!u.region,!!u.onboarded_at],pp=Math.round(pm*parts.filter(Boolean).length/3);
 out.push({id:'profile',max:pm,points:pp,state:pp>=pm?'full':pp>0?'partial':'none',detail:{name:parts[0],region:parts[1],onboarded:parts[2]}});
 const sum=out.reduce((a,b)=>a+b.points,0);
 const score=clamp(sum+u.adjust,0,100);
 const level=CFG.levels.find(l=>score>=l.min).id;
 const tips=out.filter(f=>f.points<f.max&&f.state!=='pending').sort((a,b)=>(b.max-b.points)-(a.max-a.points)).map(f=>f.id);
 if(out.find(f=>f.state==='pending'))tips.push('deliverability');
 return{score,level,since:u.created_at,factors:out,tips:[...new Set(tips)],adjust:u.adjust,updated_at:new Date().toISOString()}
}
module.exports={compute};
