import { ensure } from './schema.mjs';

// Dimensões lidas dos cabeçalhos; não é um decodificador nem um detector de conteúdo.
export function dimensions(bytes, extension) {
  let width, height;
  if (extension === 'png' && bytes.length >= 24) { width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20); }
  if (extension === 'webp' && bytes.length >= 30) {
    const kind=bytes.toString('ascii',12,16);
    if(kind==='VP8 ') {width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
    if(kind==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    if(kind==='VP8L'&&bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }
  if(['jpg','jpeg'].includes(extension)) {
    let offset=2;
    while(offset+4<=bytes.length){
      if(bytes[offset++]!==0xff)break;
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
      const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
      offset+=length;
    }
  }
  ensure(Number.isInteger(width)&&width>0&&width<=16000&&Number.isInteger(height)&&height>0&&height<=16000,'IMAGE_DIMENSIONS','Cabeçalho ou dimensões de imagem inválidos.');
  return {width,height};
}
