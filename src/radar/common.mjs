import crypto from 'node:crypto';
export class RadarError extends Error { constructor(code,message,details=null){super(message);this.code=code;this.details=details;} }
export function check(condition,code,message){if(!condition)throw new RadarError(code,message);}
export const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export function referenceUrl(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'');}catch{return null;}}
export function date(value){if(typeof value!=='string'||!value.trim())return null;const n=Date.parse(value);if(!Number.isFinite(n))return null;const ymd=value.match(/^(\d{4})-(\d\d)-(\d\d)/),rfc=value.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);let y,m,d;if(ymd)[,y,m,d]=ymd;else if(rfc){d=rfc[1];m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(rfc[2].toLowerCase())+1;y=rfc[3];}if(y){const test=new Date(Date.UTC(+y,+m-1,+d));if(test.getUTCFullYear()!==+y||test.getUTCMonth()!==+m-1||test.getUTCDate()!==+d)return null;}return new Date(n).toISOString();}
export const categories=['tecnologia','ia','games','espaco','tendencias'];
