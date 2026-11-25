import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import {check,RadarError} from './common.mjs';

export function publicAddress(address){
  if(net.isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===100&&b>=64&&b<=127||a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
  // Somente unicast global IPv6, excluindo tradução/túneis e faixas especiais.
  if(net.isIP(address)===6){const s=address.toLowerCase();const first=parseInt(s.split(':')[0],16),second=parseInt(s.split(':')[1]||'0',16);return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002&&first<0x3fff&&!s.includes('.');}return false;
}
export function targetUrl(value,hosts){let u;try{u=new URL(value);}catch{throw new RadarError('URL_BLOCKED','URL de coleta inválida.');}
  check(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443')&&hosts.includes(u.hostname)&&!net.isIP(u.hostname),'URL_BLOCKED','Coleta restrita a HTTPS/443 nos hosts explicitamente configurados.');return u;
}
export async function destination(value,hosts,{resolve=dns.lookup,timeoutMs=15000}={}){
  const url=targetUrl(value,hosts);let timer;
  try{const answers=await Promise.race([resolve(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new RadarError('TIMEOUT','Timeout de resolução DNS.')),timeoutMs);})]);
    check(Array.isArray(answers)&&answers.length>0&&answers.every(a=>publicAddress(a.address)&&net.isIP(a.address)===a.family),'ADDRESS_BLOCKED','DNS resolveu para destino interno, reservado ou não autorizado.');return {url,address:answers[0]};
  }finally{clearTimeout(timer);}
}
export function requestBytes({url,address},headers,config,request=https.request){
  return new Promise((resolve,reject)=>{let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const lookup=(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family);
    const req=request(url,{method:'GET',headers,agent:false,lookup,servername:url.hostname,maxHeaderSize:32768},res=>{
      const code=res.statusCode,meta={status:code,headers:res.headers};
      if(code!==200){finish(null,{...meta,bytes:Buffer.alloc(0)});res.destroy();return;}
      if(res.headers['content-encoding']&&!/^identity$/i.test(res.headers['content-encoding'])){finish(new RadarError('ENCODING','Resposta comprimida não solicitada.'));res.destroy();return;}
      const size=Number(res.headers['content-length']||0);if(size>config.maxResponseBytes){finish(new RadarError('RESPONSE_LIMIT','Resposta acima do limite.'));res.destroy();return;}
      const chunks=[];let count=0;
      res.on('data',b=>{count+=b.length;if(count>config.maxResponseBytes){finish(new RadarError('RESPONSE_LIMIT','Resposta acima do limite.'));res.destroy();}else chunks.push(b);});
      res.on('end',()=>finish(null,{...meta,bytes:Buffer.concat(chunks)}));res.on('error',e=>finish(e));res.on('aborted',()=>finish(new RadarError('NETWORK','Resposta interrompida.')));
    });
    const timer=setTimeout(()=>{finish(new RadarError('TIMEOUT','Timeout de coleta.'));req.destroy();},config.timeoutMs);
    req.on('error',e=>finish(e));req.end();
  });
}
