import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {confined,atomicWrite,jsonBytes} from '../editorial/repository.mjs';
export class NewsroomError extends Error {constructor(code,message){super(message);this.code=code;}}
export function check(ok,code,message){if(!ok)throw new NewsroomError(code,message);}
export const hash=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export {confined,atomicWrite,jsonBytes};
export const safeId=id=>/^pauta-[a-f0-9]{24}$/.test(id||'');
export function file(root,relative){return confined(root,relative);}
export function safeDraftId(topicId){check(safeId(topicId),'ID','ID de pauta inválido.');return `newsroom-${topicId}`;}
export function existing(root,relative){const p=file(root,relative);return fs.existsSync(p)?p:null;}
export function childFile(root,relative){const p=file(root,relative);check(path.resolve(p).startsWith(root+path.sep),'PATH','Caminho fora da raiz.');return p;}
