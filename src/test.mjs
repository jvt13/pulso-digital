import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const data=JSON.parse(fs.readFileSync(path.join(root,'content/articles.json')));const pub=path.join(root,'public');test('matérias válidas e únicas',()=>{assert.equal(new Set(data.map(a=>a.slug)).size,data.length);for(const a of data){assert.match(a.slug,/^[a-z0-9-]+$/);assert.ok(a.sections.length>=2);assert.ok(a.sources.length);assert.ok(a.sources.every(s=>s.url.startsWith('https://')));assert.ok(fs.existsSync(path.join(pub,'assets',a.image+'.svg')));assert.ok(fs.existsSync(path.join(pub,'noticias',a.slug+'.html')))}});test('links locais existentes',()=>{const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);for(const f of walk(pub).filter(x=>x.endsWith('.html'))){const h=fs.readFileSync(f,'utf8');for(const m of h.matchAll(/(?:href|src)="([^"#]+)"/g)){let l=m[1];if(/^(https?:|mailto:)/.test(l))continue;l=l.split(/[?#]/)[0];if(l)assert.ok(fs.existsSync(path.resolve(path.dirname(f),l)),`${f}: ${l}`)}}});test('publicidade desativada inicialmente',()=>{const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));if(!cfg.adsense.enabled)assert.ok(!fs.readFileSync(path.join(pub,'index.html'),'utf8').includes('pagead2.googlesyndication.com'))});
test('metadados e URLs de publicação preservam o subdiretório',()=>{
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));
  if(!cfg.siteUrl)return;
  const base=cfg.siteUrl.replace(/\/$/,'');
  assert.equal(new URL(base).protocol,'https:');
  const routes=['index.html','busca.html',...Object.keys({tecnologia:1,ia:1,games:1,espaco:1,tendencias:1}).map(c=>`categorias/${c}.html`),...data.map(a=>`noticias/${a.slug}.html`),...['sobre','editorial','privacidade','contato'].map(p=>p+'.html')];
  for(const route of routes){
    const html=fs.readFileSync(path.join(pub,route),'utf8');
    const canonical=html.match(/<link rel="canonical" href="([^"]+)"/);
    assert.equal(canonical?.[1],base+'/'+route,route);
    assert.ok(html.includes(`<meta property="og:url" content="${base}/${route}">`),route);
    if(route.startsWith('noticias/')){
      const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
      assert.equal(schema.mainEntityOfPage,base+'/'+route);
      assert.ok(schema.image.every(url=>url.startsWith(base+'/assets/')));
    }
  }
  const sitemap=fs.readFileSync(path.join(pub,'sitemap.xml'),'utf8');
  for(const route of routes.filter(r=>r!=='busca.html'))assert.ok(sitemap.includes(`<loc>${base}/${route}</loc>`),route);
  assert.ok(!sitemap.includes('/busca.html'));
  assert.ok(fs.readFileSync(path.join(pub,'busca.html'),'utf8').includes('content="noindex,follow"'));
  assert.ok(fs.readFileSync(path.join(pub,'robots.txt'),'utf8').includes(`Sitemap: ${base}/sitemap.xml`));
  const rss=fs.readFileSync(path.join(pub,'rss.xml'),'utf8');
  for(const a of data)assert.ok(rss.includes(`<link>${base}/noticias/${a.slug}.html</link>`));
});
