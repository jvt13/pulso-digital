import sax from 'sax';
import {check,RadarError} from './common.mjs';

// SAX estrito; nenhuma entidade customizada/DTD é carregada. Regex não faz parsing XML.
export function parseXml(bytes,limits){
  check(bytes.length<=limits.maxResponseBytes,'RESPONSE_LIMIT','XML acima do limite.');
  let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new RadarError('XML_ENCODING','Feed não é UTF-8 válido.');}
  const stack=[],roots=[];let nodes=0;
  const p=sax.parser(true,{xmlns:true,strictEntities:true,position:false});
  const forbidden=()=>{throw new RadarError('XML_DTD','DTD e declarações de entidades são proibidas.');};
  p.ondoctype=forbidden;p.onsgmldeclaration=forbidden;
  p.onprocessinginstruction=n=>check(n.name==='xml'&&!/encoding\s*=\s*['"](?!utf-8['"])/i.test(n.body),'XML_ENCODING','Instrução XML/encoding não autorizado.');
  p.onerror=()=>{throw new RadarError('XML_INVALID','XML inválido.');};
  p.onopentag=n=>{check(++nodes<=limits.xmlNodes&&stack.length<limits.xmlDepth,'XML_LIMIT','XML excessivamente aninhado ou com nós demais.');const node={name:n.local,uri:n.uri,attributes:Object.fromEntries(Object.values(n.attributes).map(a=>[a.name,a.value])),text:'',children:[]};if(stack.length)stack.at(-1).children.push(node);else roots.push(node);stack.push(node);};
  const text=t=>{if(stack.length){const node=stack.at(-1);check(node.text.length+t.length<=limits.maxResponseBytes,'XML_LIMIT','Texto XML acima do limite.');node.text+=t;}};
  p.ontext=text;p.oncdata=text;p.onclosetag=()=>stack.pop();
  try{for(let i=0;i<xml.length;i+=4096)p.write(xml.slice(i,i+4096));p.close();}catch(e){if(e instanceof RadarError)throw e;throw new RadarError('XML_INVALID','XML inválido ou token acima do limite.');}
  check(roots.length===1&&!stack.length,'XML_INVALID','Raiz XML inválida.');return roots[0];
}
export const children=(n,name,uri)=>n.children.filter(c=>c.name===name&&(uri===undefined||c.uri===uri));
export const child=(n,name,uri)=>children(n,name,uri)[0];
export const text=n=>n?(n.text+n.children.map(text).join(' ')).trim():'';
export function plain(value,max=1000){return value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
