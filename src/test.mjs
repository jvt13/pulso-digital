import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const data=JSON.parse(fs.readFileSync(path.join(root,'content/articles.json')));const pub=path.join(root,'public');test('matérias válidas e únicas',()=>{assert.equal(new Set(data.map(a=>a.slug)).size,data.length);for(const a of data){assert.match(a.slug,/^[a-z0-9-]+$/);assert.ok(a.sections.length>=2);assert.ok(a.sources.length);assert.ok(a.sources.every(s=>['http:','https:'].includes(new URL(s.url).protocol)));assert.ok(fs.existsSync(path.join(pub,'assets',a.image+'.svg'))||Object.values(JSON.parse(fs.readFileSync(path.join(root,'content/images.json')))[a.image]?.files||{}).length>=3);assert.ok(fs.existsSync(path.join(pub,'noticias',a.slug+'.html')))}});test('links locais existentes',()=>{const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);for(const f of walk(pub).filter(x=>x.endsWith('.html'))){const h=fs.readFileSync(f,'utf8');for(const m of h.matchAll(/(?:href|src)="([^"#]+)"/g)){let l=m[1];if(/^(https?:|mailto:)/.test(l))continue;l=l.split(/[?#]/)[0];if(l)assert.ok(fs.existsSync(path.resolve(path.dirname(f),l)),`${f}: ${l}`)}}});test('publicidade desativada inicialmente',()=>{const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));if(!cfg.adsense.enabled)assert.ok(!fs.readFileSync(path.join(pub,'index.html'),'utf8').includes('pagead2.googlesyndication.com'))});
test('metadados e URLs de publicação preservam o subdiretório',()=>{
  const baseConfig=JSON.parse(fs.readFileSync(path.join(root,'config.json')));
  const environments=JSON.parse(fs.readFileSync(path.join(root,'site/environments.json')));
  const cfg={...baseConfig,...environments.environments.homologation};
  if(!cfg.siteUrl)return;
  const base=cfg.siteUrl.replace(/\/$/,'');
  assert.equal(new URL(base).protocol,'https:');
  const routes=['index.html','busca.html',...Object.keys({tecnologia:1,ia:1,games:1,espaco:1,tendencias:1}).map(c=>`categorias/${c}.html`),...data.map(a=>`noticias/${a.slug}.html`),...['sobre','editorial','privacidade','contato'].map(p=>p+'.html')];
  for(const route of routes){
    const html=fs.readFileSync(path.join(pub,route),'utf8');
    const canonical=html.match(/<link rel="canonical" href="([^"]+)"/);
    const expected=route==='index.html'?base+'/':base+'/'+route;
    assert.equal(canonical?.[1],expected,route);
    assert.ok(html.includes(`<meta property="og:url" content="${expected}">`),route);
    if(route.startsWith('noticias/')){
      const schema=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match)=>JSON.parse(match[1])).find((value)=>value['@type']==='NewsArticle');
      assert.equal(schema.mainEntityOfPage,base+'/'+route);
      assert.ok(schema.image.every(url=>url.startsWith(base+'/assets/')));
    }
  }
  const sitemap=fs.readFileSync(path.join(pub,'sitemap.xml'),'utf8');
  for(const route of routes.filter(r=>r!=='busca.html'))assert.ok(sitemap.includes(`<loc>${route==='index.html'?base+'/':base+'/'+route}</loc>`),route);
  assert.ok(!sitemap.includes('/busca.html'));
  assert.ok(fs.readFileSync(path.join(pub,'busca.html'),'utf8').includes('content="noindex,follow"'));
  assert.ok(fs.readFileSync(path.join(pub,'robots.txt'),'utf8').includes(`Sitemap: ${base}/sitemap.xml`));
  const rss=fs.readFileSync(path.join(pub,'rss.xml'),'utf8');
  for(const a of data)assert.ok(rss.includes(`<link>${base}/noticias/${a.slug}.html</link>`));
});
test('rastreabilidade editorial e datas reais de revisão',()=>{
  const brand=JSON.parse(fs.readFileSync(path.join(root,'config.json'))).publicName;
  const originalDates={'gta-vi-lancamento-vice-city':'2026-11-24','gemini-4-neon-nova-ia-google':'2026-11-24','webb-fusao-estelar-andromeda':'2026-11-24','steam-machine-pc-sala':'2026-11-23','artemis-ii-o-que-vem-depois':'2026-11-23','agentes-ia-microsoft-ibm-empresas':'2026-11-22','black-friday-tecnologia-como-comprar':'2026-11-24','pixel-gemini-atualizacao-novembro':'2026-11-22'};
  for(const slug of Object.keys(originalDates))assert.ok(data.some(a=>a.slug===slug),slug);
  for(const a of data){
    if(Object.hasOwn(originalDates,a.slug))assert.equal(a.date,originalDates[a.slug]);else assert.ok(a.publishedAt);
    assert.ok(Number.isFinite(Date.parse(a.updatedAt))&&a.updatedAt>=a.date);
    assert.equal(a.editorial.name,'Pulso Digital');
    assert.equal(a.editorial.role,'Edição institucional provisória');
    assert.ok(a.summary&&a.tags.length&&a.correctionNote&&a.verification.method);
    assert.match(a.verification.checkedAt,/^\d{4}-\d{2}-\d{2}$/);
    for(const source of a.sources){if(Object.hasOwn(originalDates,a.slug))assert.equal(source.checkedAt,a.verification.checkedAt);else assert.ok(source.checkedAt<=a.verification.checkedAt);assert.ok(['http:','https:'].includes(new URL(source.url).protocol));}
    const html=fs.readFileSync(path.join(pub,'noticias',a.slug+'.html'),'utf8');
    const schema=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match)=>JSON.parse(match[1])).find((value)=>value['@type']==='NewsArticle');
    assert.equal(schema.datePublished,a.date);assert.equal(schema.dateModified,a.updatedAt);
    assert.equal(schema.author.name,brand);assert.equal(schema.author['@type'],'Organization');
    assert.deepEqual(schema.citation,a.sources.map(s=>s.url));
    assert.ok(html.includes(`datetime="${a.updatedAt}"`));assert.ok(html.includes(a.correctionNote.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')));
  }
});

test('imagens locais com proveniência, formatos e dimensões verificáveis',()=>{
  const images=JSON.parse(fs.readFileSync(path.join(root,'content/images.json')));
  for(const a of data){
    const image=images[a.image];assert.ok(image, a.slug);
    assert.ok(image.credit&&image.sourceUrl&&image.license&&image.licenseUrl&&image.alt&&image.caption);
    assert.ok(image.width>=1200);assert.equal(image.width*9,image.height*16);
    for(const [suffix,file] of Object.entries(image.files)){
      const bytes=fs.readFileSync(path.join(pub,file.path));assert.equal(bytes.length,file.bytes,file.path);
      if(suffix.endsWith('.webp')){assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');}
      else assert.equal(bytes.readUInt16BE(0),0xffd8);
    }
    if(image.kind==='illustration')assert.ok(image.caption.includes('Ilustração'));
    const html=fs.readFileSync(path.join(pub,'noticias',a.slug+'.html'),'utf8');
    assert.ok(html.includes(image.src)&&html.includes(image.smallSrc)&&html.includes(image.shareSrc));
  }
});

test('Twitter, Open Graph, breadcrumbs, preview e concordância',()=>{
  const images=JSON.parse(fs.readFileSync(path.join(root,'content/images.json')));
  const environments=JSON.parse(fs.readFileSync(path.join(root,'site/environments.json')));
  const siteUrl=environments.environments.homologation.siteUrl;
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);
  for(const file of walk(pub).filter(f=>f.endsWith('.html'))){
    const html=fs.readFileSync(file,'utf8');
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'),file);
    const image=Object.values(images).find(image=>html.includes('property="og:image" content="'+siteUrl+'/'+image.shareSrc+'"'));
    assert.ok(image&&image.width>=1200&&image.width*9===image.height*16,file);
    assert.ok(html.includes('property="og:image:width" content="'+image.width+'"'),file);
    assert.ok(html.includes('property="og:image:height" content="'+image.height+'"'),file);
    assert.ok(html.includes('content="noindex,follow"'),file);
    if(path.basename(file)!=='index.html'){
      const schemas=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m=>JSON.parse(m[1]));
      const crumbs=schemas.find(s=>s['@type']==='BreadcrumbList');assert.ok(crumbs,file);
      assert.deepEqual(crumbs.itemListElement.map(x=>x.position),crumbs.itemListElement.map((_,i)=>i+1));
      assert.ok(html.includes('aria-label="Trilha de navegação"'),file);
    }
    assert.ok(!html.includes('1 matérias'),file);
  }
  for(const a of data){
    const html=fs.readFileSync(path.join(pub,'noticias',a.slug+'.html'),'utf8');
    const encodedAlt=images[a.image].alt.replaceAll('&','&amp;').replaceAll('"','&quot;');
    assert.ok(html.includes(`property="og:image:alt" content="${encodedAlt}"`));
    assert.ok(html.includes(`name="twitter:image:alt" content="${encodedAlt}"`));
  }
});

test('sitemap lastmod e RSS refletem os registros publicados',()=>{
  const sitemap=fs.readFileSync(path.join(pub,'sitemap.xml'),'utf8'),rss=fs.readFileSync(path.join(pub,'rss.xml'),'utf8');
  for(const a of data){assert.ok(sitemap.includes(`<lastmod>${a.updatedAt}</lastmod>`));assert.ok(rss.includes(a.slug+'-share.jpg'));}
  assert.equal((rss.match(/<item>/g)||[]).length,data.length);
  assert.equal((rss.match(/<media:credit>/g)||[]).length,data.length);
  assert.ok(rss.includes('<language>pt-BR</language>'));
  assert.equal((rss.match(/<dc:date>/g)||[]).length,data.length);
  if(data.every(a=>!a.date.includes('T')))assert.ok(!rss.includes('<pubDate>'),'não inventar horário de publicação quando só o dia é conhecido');
  assert.ok(!sitemap.includes('busca.html'));
});
