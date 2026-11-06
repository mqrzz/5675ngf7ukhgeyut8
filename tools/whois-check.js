const u=process.argv[2];if(!u){console.log('usage: node tools_whois_check.js example.com');process.exit(1)}
const net=require('net');
async function get(url){try{const r=await fetch(url,{headers:{accept:'application/rdap+json','user-agent':'Geserd-lookup/1.0'},redirect:'follow'});return r.status+' '+url}catch(e){return 'FAIL '+url+' '+e.message}}
function tcp(host){return new Promise(res=>{const s=net.connect({host,port:43,timeout:6000});s.on('connect',()=>{s.destroy();res('ok '+host+':43')});s.on('timeout',()=>{s.destroy();res('timeout '+host+':43 (port 43 is probably blocked by the host)')});s.on('error',e=>res('FAIL '+host+':43 '+e.message))})}
(async()=>{
 console.log(await get('https://data.iana.org/rdap/dns.json'));
 console.log(await get('https://rdap.org/domain/'+u));
 console.log(await get('https://rdap.verisign.com/com/v1/domain/'+u));
 console.log(await tcp('whois.iana.org'));
 console.log(await tcp('whois.tcinet.ru'));
})();
