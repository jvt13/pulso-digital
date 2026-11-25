import {parse} from 'parse5';
import {check,hash} from './common.mjs';
import {rankExcerpts} from './evidence-quality.mjs';

const forbidden=new Set(['script','style','nav','footer','aside','form','noscript','svg','iframe','template']);
const attr=(node,name)=>node.attrs?.find(a=>a.name===name)?.value||null;
function descendants(node,predicate,out=[]){if(forbidden.has(node.tagName))return out;if(predicate(node))out.push(node);for(const c of node.childNodes||[])descendants(c,predicate,out);return out;}
function plain(node){if(node.nodeName==='#text')return node.value||'';if(forbidden.has(node.tagName))return '';return (node.childNodes||[]).map(plain).join(' ');}
const compact=s=>s.replace(/\s+/g,' ').trim();

export function extractHtml(bytes,finalUrl){
  check(Buffer.isBuffer(bytes)&&bytes.length<=524288,'HTML_LIMIT','HTML acima do limite.');
  const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const doc=parse(html),meta=descendants(doc,n=>n.tagName==='meta');
  const og=(key)=>meta.find(n=>attr(n,'property')===key||attr(n,'name')===key)?.attrs?.find(a=>a.name==='content')?.value||null;
  const titleNode=descendants(doc,n=>n.tagName==='h1')[0]||descendants(doc,n=>n.tagName==='title')[0];
  const title=compact(og('og:title')||titleNode&&plain(titleNode)||'').slice(0,240);
  const date=og('article:published_time')||meta.find(n=>attr(n,'name')==='date')?.attrs?.find(a=>a.name==='content')?.value||null;
  const main=descendants(doc,n=>n.tagName==='article')[0]||descendants(doc,n=>n.tagName==='main')[0]||descendants(doc,n=>n.tagName==='body')[0]||doc;
  const parts=descendants(main,n=>['p','h2','h3','li'].includes(n.tagName))
    .map(n=>compact(plain(n)))
    .filter(s=>s.length>=35&&!/cookie|subscribe|newsletter|privacy policy/i.test(s));
  const excerptDetails=rankExcerpts(parts,{limit:14,maxChars:600});
  const excerpts=excerptDetails.map(item=>item.text);
  check(title&&excerpts.length,'EXTRACT_INSUFFICIENT','Página sem título ou trechos úteis.');
  return {
    title,
    date,
    dateValid:date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null,
    excerpts,
    excerptDetails,
    contentHash:hash(bytes),
    url:finalUrl,
  };
}
