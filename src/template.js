const VAR=/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]{0,39})\s*\}\}/g;
const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>ESC[c]);
function vars(...parts){const out=new Set();for(const p of parts){if(!p)continue;String(p).replace(VAR,(m,k)=>{out.add(k);return m})}return[...out]}
function render(str,values,html){
 if(!str)return str;
 const v=values||{};
 return String(str).replace(VAR,(m,k)=>{if(!Object.prototype.hasOwnProperty.call(v,k)||v[k]==null)return '';const x=String(v[k]);return html?esc(x):x})}
function clean(values){
 const o={};if(!values||typeof values!=='object'||Array.isArray(values))return o;
 let n=0;for(const[k,v]of Object.entries(values)){if(++n>60)break;if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(k))continue;if(v==null||typeof v==='object')continue;o[k]=String(v).slice(0,5000)}
 return o}
module.exports={vars,render,clean,esc};
