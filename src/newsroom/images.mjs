import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {dimensions} from '../editorial/image.mjs';
import {safeUrl,validDate} from '../editorial/validator.mjs';
import {check,file,readJson,atomicWrite} from './common.mjs';

export function inspectImage(root,topicId){
  const base=`newsroom/data/images/${topicId}`,manifestPath=file(root,base+'/manifest.json');
  if(!fs.existsSync(manifestPath))return {ready:false,status:'image-pending',reason:'Nenhum manifesto de imagem autorizado foi preparado.'};
  const manifest=readJson(manifestPath);
  for(const field of ['kind','credit','sourceUrl','license','licenseUrl','authorizationBasis','alt','caption'])check(typeof manifest[field]==='string'&&manifest[field].trim(),'IMAGE_MANIFEST',`Campo ${field} ausente.`);
  check(['photograph','illustration'].includes(manifest.kind)&&safeUrl(manifest.sourceUrl)&&safeUrl(manifest.licenseUrl)&&manifest.authorizationBasis.length>=10&&validDate(manifest.checkedAt)&&manifest.checkedAt<=new Date().toISOString().slice(0,10),'IMAGE_AUTHORIZATION','Fundamento ou data de verificação inválidos.');
  if(manifest.rightsType!==undefined){
    check(['self-created','official-authorized','licensed','public-domain'].includes(manifest.rightsType),'IMAGE_AUTHORIZATION','Tipo de direitos desconhecido.');
    if(manifest.rightsType==='self-created'){
      check(manifest.kind==='illustration'&&/Pulso Digital/i.test(manifest.credit),'IMAGE_AUTHORIZATION','Ilustração própria exige crédito Pulso Digital e tipo illustration.');
      check(manifest.thirdPartyElements===undefined||(Array.isArray(manifest.thirdPartyElements)&&manifest.thirdPartyElements.length===0),'IMAGE_AUTHORIZATION','Ilustração própria não pode conter elementos de terceiros.');
      check(/pr[oó]pri|original|autoral/i.test(`${manifest.license} ${manifest.authorizationBasis}`),'IMAGE_AUTHORIZATION','Declare explicitamente a autoria própria da ilustração.');
    }
  }
  if(manifest.kind==='illustration')check(/ilustra/i.test(manifest.alt)&&/ilustra/i.test(manifest.caption),'IMAGE_LABEL','Ilustração deve ser identificada.');
  const spec=[['main.webp',1600,900],['small.webp',640,360],['share.jpg',1600,900]],assets=[];
  if(spec.some(([name])=>!fs.existsSync(file(root,base+'/'+name)))){
    const originals=['original.jpg','original.jpeg','original.png','original.webp'].filter(name=>fs.existsSync(file(root,base+'/'+name)));
    if(!originals.length)return {ready:false,status:'image-pending',reason:'Manifesto presente, mas original/variantes ainda não preparados.'};
    check(originals.length===1,'IMAGE_SOURCE','Informe exatamente um arquivo original.');
    const source=file(root,base+'/'+originals[0]),stat=fs.lstatSync(source);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=10485760,'IMAGE_SOURCE','Original inválido ou acima de 10 MiB.');
    const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../newsroom/tools/convert_image.py');
    const conversion=spawnSync('python',[script,source,file(root,base)],{shell:false,timeout:30000,encoding:'utf8',windowsHide:true,maxBuffer:4096});
    check(!conversion.error&&conversion.status===0,'IMAGE_CONVERSION','Conversão local indisponível ou imagem pequena/incompatível; instale Pillow localmente e confira o original.');
  }
  for(const [name,w,h] of spec){const relative=base+'/'+name,p=file(root,relative),stat=fs.lstatSync(p);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=5242880,'IMAGE_FILE','Imagem não regular ou acima do limite.');const bytes=fs.readFileSync(p),ext=name.endsWith('webp')?'webp':'jpg';check(ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes[0]===255&&bytes[1]===216,'IMAGE_FILE','Cabeçalho de imagem inválido.');const dim=dimensions(bytes,ext);check(dim.width===w&&dim.height===h,'IMAGE_DIMENSIONS','Dimensões esperadas não atendidas; não amplie bitmap pequeno.');assets.push({name,relative,width:w,height:h,bytes:stat.size});}
  const key=`newsroom-${topicId}`,dest=`assets/editorial/${key}/`;
  const files=Object.fromEntries(assets.map(a=>[a.name,{path:dest+a.name,width:a.width,height:a.height,bytes:a.bytes}]));
  const record={kind:manifest.kind,credit:manifest.credit,sourceUrl:manifest.sourceUrl,license:manifest.license,licenseUrl:manifest.licenseUrl,alt:manifest.alt,caption:manifest.caption,src:files['main.webp'].path,smallSrc:files['small.webp'].path,shareSrc:files['share.jpg'].path,width:1600,height:900,previewAllowed:!!manifest.previewAllowed,checkedAt:manifest.checkedAt,files};
  const image={key,credit:manifest.credit,alt:manifest.alt,caption:manifest.caption,authorization:{basis:manifest.authorizationBasis,url:manifest.licenseUrl},record,assets:assets.map(a=>({from:`editorial/data/incoming/${key}/${a.name}`,to:dest+a.name}))};
  return {ready:true,status:'ready-to-import',manifest,assets,image};
}
export function stageImage(root,topicId,prepared){
  check(prepared.ready,'IMAGE_PENDING','Imagem ainda não autorizada.');
  const key=`newsroom-${topicId}`;
  for(const asset of prepared.assets){const target=file(root,`editorial/data/incoming/${key}/${asset.name}`),bytes=fs.readFileSync(file(root,asset.relative));if(fs.existsSync(target))check(fs.readFileSync(target).equals(bytes),'IMAGE_CONFLICT','Asset incoming difere; não sobrescrever.');else atomicWrite(target,bytes);}
  return prepared.image;
}
