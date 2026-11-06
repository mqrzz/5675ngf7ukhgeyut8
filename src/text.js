const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',copy:'©',reg:'®',hellip:'…',mdash:'—',ndash:'–',laquo:'«',raquo:'»',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',bull:'•',middot:'·',euro:'€',pound:'£'};
const dec=s=>s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>{
 if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);try{return String.fromCodePoint(n)}catch{return m}}
 return ENT[e.toLowerCase()]!=null?ENT[e.toLowerCase()]:m});
function toText(html){
 let s=String(html||'');
 s=s.replace(/<!--[\s\S]*?-->/g,'').replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi,'');
 s=s.replace(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(m,h,t)=>{const x=t.replace(/<[^>]+>/g,'').trim();return /^(https?:|mailto:)/i.test(h)&&x&&x!==h?x+' ('+h+')':x||h});
 s=s.replace(/<img\s[^>]*?alt\s*=\s*["']([^"']*)["'][^>]*>/gi,'$1');
 s=s.replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|blockquote|section|article)>/gi,'\n\n').replace(/<li[^>]*>/gi,'\n• ').replace(/<\/(td|th)>/gi,'  ');
 s=s.replace(/<[^>]+>/g,'');
 s=dec(s).replace(/[ \t\u00a0]+/g,' ').split('\n').map(x=>x.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
 return s}
module.exports={toText};
