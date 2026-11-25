import fs from 'node:fs';
import path from 'node:path';
import {check} from './common.mjs';
export function loadLocalEnv(root){
  const target=path.join(root,'.env');if(!fs.existsSync(target))return {loaded:false};
  const stat=fs.lstatSync(target);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4096,'ENV','Arquivo .env inválido ou grande demais.');
  const data=fs.readFileSync(target,'utf8');
  for(const line of data.split(/\r?\n/)){const text=line.trim();if(!text||text.startsWith('#'))continue;const match=/^(GROQ_API_KEY|GEMINI_API_KEY|PULSO_STORAGE_KEY)=(.*)$/.exec(text);check(match,'ENV','Use apenas GROQ_API_KEY, GEMINI_API_KEY ou PULSO_STORAGE_KEY em .env.');let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);check(!/[\r\n\u0000]/.test(value),'ENV','Valor .env inválido.');if(!process.env[match[1]])process.env[match[1]]=value;}
  return {loaded:true};
}
