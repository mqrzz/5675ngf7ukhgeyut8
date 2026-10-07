const R=require('../config/regions.json');const C=require('../config/countries.json');const GEO=require('./geo');
const ALL=new Set(C.all);const EU=new Set(R.eu_countries);
function regionOf(cc){
 cc=String(cc||'').toUpperCase();
 for(const[k,v]of Object.entries(R.regions)){if(Array.isArray(v.countries)&&v.countries.includes(cc))return k}
 if(EU.has(cc))return'eu';
 return R.default
}
function valid(cc){cc=String(cc||'').toUpperCase();return/^[A-Z]{2}$/.test(cc)&&ALL.has(cc)&&!GEO.isBlocked(cc)}
function policy(region){return R.regions[region]||R.regions[R.default]}
function loginFor(region){return policy(region).login.filter(x=>x!=='email')}
function dataRegionFor(region){const want=policy(region).data_region;const d=R.data_regions[want];return d&&d.enabled?want:'main'}
function profile(cc){
 cc=String(cc).toUpperCase();const region=regionOf(cc),p=policy(region);
 return{country:cc,region,currency:p.currency,display:p.display,payment:p.payment,data_region:dataRegionFor(region)}
}
function loginForIp(cc){
 if(!cc)return policy(R.default).login.filter(x=>x!=='email');
 return loginFor(regionOf(cc))
}
function publicList(){
 return{groups:C.groups,blocked:GEO.list(),country_region:Object.fromEntries(C.all.filter(valid).map(c=>[c,regionOf(c)])),regions:Object.fromEntries(Object.entries(R.regions).map(([k,v])=>[k,{login:v.login,display:v.display,currency:v.currency,payment:v.payment,data_region:dataRegionFor(k)}]))}
}
module.exports={regionOf,valid,policy,loginFor,loginForIp,dataRegionFor,profile,publicList,config:R};
