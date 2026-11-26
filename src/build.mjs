import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {artwork} from './art.mjs';
import {loadSiteConfig} from './site-config.mjs';
import {runtimeDataPath} from './runtime/paths.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--environment' || argument === '--output') {
      if (!argv[index + 1]) throw new Error(`Valor ausente para ${argument}.`);
      options[argument.slice(2)] = argv[++index];
    } else {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
  }
  return options;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function displayDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value.includes('T') ? value : `${value}T12:00:00Z`));
}

export function buildSite({root = projectRoot, environment, output} = {}) {
  const sourceRoot = path.resolve(root);
  const cfg = loadSiteConfig(sourceRoot, environment);
  const out = path.resolve(sourceRoot, output || cfg.output);
  const lock = runtimeDataPath(sourceRoot, 'editorial/data/lock');
  const journal = runtimeDataPath(sourceRoot, 'editorial/data/transaction.json');
  if (fs.existsSync(lock) || fs.existsSync(journal)) {
    throw new Error('Operação editorial ativa ou recuperação pendente; build bloqueado para evitar inconsistência.');
  }

  const articles = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'content/articles.json'), 'utf8'));
  const images = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'content/images.json'), 'utf8'));
  const categories = {
    tecnologia: 'Tecnologia',
    ia: 'Inteligência artificial',
    games: 'Games',
    espaco: 'Ciência & Espaço',
    tendencias: 'Tendências',
  };
  const esc = escapeHtml;
  const e = esc;
  const sorted = [...articles].sort((left, right) => right.date.localeCompare(left.date));
  const featured = articles.find((article) => article.featured) || sorted[0];
  const href = (article) => `noticias/${article.slug}.html`;
  const minutes = (article) => Math.max(2, Math.ceil(article.sections.flatMap((section) => section.paragraphs).join(' ').split(/\s+/).length / 180));
  const base = cfg.siteUrl.replace(/\/$/, '');
  const canonicalUrl = (route) => route === 'index.html' ? `${base}/` : `${base}/${route}`;
  const ads = cfg.adsense.enabled && /^ca-pub-\d+$/.test(cfg.adsense.client || '') && Boolean(base);
  const brandMark = `<img class="brand-mark" src="ASSET_PREFIX/assets/pulsobit-mark.svg" width="42" height="42" alt="">`;
  const brandText = `<span class="brand-word"><span class="brand-pulse">Pulso</span><span class="brand-bit">Bit</span></span><small>O PULSO DA TECNOLOGIA</small>`;
  const brand = (prefix) => `${brandMark.replace('ASSET_PREFIX', prefix.replace(/\/$/, '') || '.')}${brandText}`;
  const jsonld = (value) => `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
  const siteGraph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name: cfg.name,
        url: `${base}/`,
        logo: `${base}/assets/pulsobit-logo-dark.svg`,
        description: cfg.description,
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: `${base}/`,
        name: cfg.name,
        description: cfg.description,
        inLanguage: 'pt-BR',
        publisher: {'@id': `${base}/#organization`},
      },
    ],
  };
  const imageData = (article) => images[typeof article === 'string' ? article : article?.image] || {
    src: `assets/${typeof article === 'string' ? article : article?.image || 'vice-city'}.svg`,
    width: 1000,
    height: 560,
    alt: `Ilustração conceitual do ${cfg.name}`,
  };
  const breadcrumbs = (route, title, schema) => {
    if (route === 'index.html') return '';
    const items = [{name: 'Início', item: `${base}/`}];
    if (route.startsWith('noticias/')) {
      const article = articles.find((candidate) => href(candidate) === route);
      items.push({name: schema.articleSection, item: `${base}/categorias/${article.category}.html`});
    }
    items.push({name: title, item: canonicalUrl(route)});
    return jsonld({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({'@type': 'ListItem', position: index + 1, ...item})),
    });
  };
  const robots = (search = false) => {
    if (!cfg.indexing || search) return '<meta name="robots" content="noindex,follow">';
    return imageData(featured).previewAllowed ? '<meta name="robots" content="max-image-preview:large">' : '';
  };
  const socialImage = (image) => {
    const data = imageData(image || featured);
    return {
      data,
      url: `${base}/${data.shareSrc || data.src}`,
      type: data.shareSrc?.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
    };
  };
  const page = (title, description, body, {
    p = './',
    route = 'index.html',
    active = '',
    schema = null,
    image = null,
    search = false,
    published = null,
    modified = null,
  } = {}) => {
    const social = socialImage(image);
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} | ${e(cfg.name)}</title><meta name="description" content="${e(description)}"><meta name="theme-color" content="#0d1728"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="${e(cfg.name)}"><meta property="og:type" content="${schema ? 'article' : 'website'}"><link rel="canonical" href="${e(canonicalUrl(route))}"><meta property="og:url" content="${e(canonicalUrl(route))}"><meta property="og:image" content="${e(social.url)}"><meta property="og:image:type" content="${social.type}"><meta property="og:image:width" content="${social.data.width}"><meta property="og:image:height" content="${social.data.height}"><meta property="og:image:alt" content="${e(social.data.alt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(social.url)}"><meta name="twitter:image:alt" content="${e(social.data.alt)}">${published ? `<meta property="article:published_time" content="${e(published)}">` : ''}${modified ? `<meta property="article:modified_time" content="${e(modified)}">` : ''}<link rel="alternate" type="application/rss+xml" title="${e(cfg.name)}" href="${p}rss.xml">${robots(search)}<link rel="icon" href="${p}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${p}assets/style.css"><script>try{document.documentElement.dataset.theme=localStorage.getItem('pulso-theme')||'dark'}catch(e){}</script>${jsonld(siteGraph)}${schema ? jsonld(schema) : ''}${breadcrumbs(route, title, schema)}${ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${e(cfg.adsense.client)}" crossorigin="anonymous"></script>` : ''}</head><body><a class="skip" href="#main">Ir ao conteúdo</a>${nav(p, active)}<main id="main">${body}</main>${footer(p)}<script src="${p}assets/site.js" defer></script></body></html>`;
  };
  const nav = (prefix, active = '') => `<header class="site-head"><div class="top wrap"><a class="brand" href="${prefix}index.html" aria-label="${e(cfg.name)} — início">${brand(prefix)}</a><div class="tagline">O PULSO DA TECNOLOGIA.</div><div class="head-actions"><button class="icon-btn" id="theme" aria-label="Alternar tema">◐</button><a class="icon-btn search-link" href="${prefix}busca.html" aria-label="Buscar notícias">⌕</a><button class="icon-btn mobile-menu" aria-label="Abrir menu" aria-expanded="false" id="menu">☰</button></div></div><nav class="nav wrap" id="nav"><a class="${active === 'home' ? 'active' : ''}" href="${prefix}index.html">Início</a>${Object.entries(categories).map(([key, value]) => `<a class="${active === key ? 'active' : ''}" href="${prefix}categorias/${key}.html">${e(value)}</a>`).join('')}<a href="${prefix}busca.html" class="nav-search">Buscar notícias <span>↗</span></a></nav></header>`;
  const footer = (prefix) => `<footer><div class="wrap foot-grid"><div><a class="brand" href="${prefix}index.html" aria-label="${e(cfg.name)} — início">${brand(prefix)}</a><p>Notícias, contexto e ideias para entender um mundo que não para.</p></div><div><b>Explore</b>${Object.entries(categories).map(([key, value]) => `<a href="${prefix}categorias/${key}.html">${e(value)}</a>`).join('')}</div><div><b>Institucional</b><a href="${prefix}sobre.html">Sobre nós</a><a href="${prefix}editorial.html">Política editorial</a><a href="${prefix}privacidade.html">Privacidade</a><a href="${prefix}contato.html">Contato e correções</a></div></div><div class="wrap foot-bottom">© 2026 ${e(cfg.name)} · Projeto editorial independente <span>O pulso da tecnologia.</span></div></footer>`;
  const write = (relative, content) => {
    const destination = path.join(out, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    const rendered = relative.endsWith('.html')
      ? content.replace(/(<link rel="stylesheet" href="([^"]*?)assets\/style\.css")>/, '$1><link rel="stylesheet" href="$2assets/pulsobit.css">')
      : content;
    fs.writeFileSync(destination, rendered);
  };
  const ad = (slot) => ads && /^\d+$/.test(cfg.adsense.slots?.[slot] || '')
    ? `<aside class="ad"><span>PUBLICIDADE</span><ins class="adsbygoogle" style="display:block" data-ad-client="${e(cfg.adsense.client)}" data-ad-slot="${e(cfg.adsense.slots[slot])}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({})</script></aside>`
    : '';
  const img = (article, prefix, extra = '', sizes = '(max-width:360px) calc(100vw - 32px), (max-width:680px) calc((100vw - 42px) / 2), (max-width:900px) 40vw, 440px') => {
    const data = imageData(article);
    return `<img ${extra} decoding="async" src="${prefix}${e(data.src)}" ${data.smallSrc ? `srcset="${prefix}${e(data.smallSrc)} 640w, ${prefix}${e(data.src)} ${data.width}w" sizes="${sizes}"` : ''} alt="${e(data.alt)}" width="${data.width}" height="${data.height}">`;
  };
  const badge = (article) => `<span class="category ${article.category}">${e(categories[article.category])}</span>`;
  const card = (article, prefix) => `<article class="news-card" data-card data-category="${e(article.category)}" data-date="${e(article.date)}" data-title="${e([article.title, article.summary, categories[article.category], ...article.tags].join(' '))}"><a class="card-image" href="${prefix}${href(article)}">${img(article, prefix, 'loading="lazy"')}</a><div class="card-body">${badge(article)}<h3><a href="${prefix}${href(article)}">${e(article.title)}</a></h3><p>${e(article.summary)}</p><div class="meta"><time datetime="${article.date}">${displayDate(article.date)}</time><span>·</span>${minutes(article)} min</div></div></article>`;
  const hero = (article, prefix, main = false) => `<a class="hero-card ${main ? 'hero-main' : ''}" href="${prefix}${href(article)}">${img(article, prefix, main ? 'fetchpriority="high"' : '', main ? '(max-width:680px) calc(100vw - 32px), (max-width:1260px) 63vw, 760px' : '(max-width:680px) calc((100vw - 42px) / 2), 440px')}<div class="hero-copy">${badge(article)}${main ? '<span class="feature-label">DESTAQUE DA EDIÇÃO</span>' : ''}<${main ? 'h1' : 'h2'}>${e(article.title)}</${main ? 'h1' : 'h2'}>${main ? `<p>${e(article.summary)}</p>` : ''}<span class="hero-link">Ler matéria <span>↗</span></span></div></a>`;
  const section = (title, subtitle, link = '') => `<div class="section-head"><div><div class="eyebrow"><i></i>${e(subtitle)}</div><h2>${e(title)}</h2></div>${link ? `<a class="more" href="${link}">Ver todas ↗</a>` : ''}</div>`;
  const trend = sorted.filter((article) => article.spotlight).concat(sorted.filter((article) => !article.spotlight)).slice(0, 4);
  const rail = (prefix) => `<aside class="rail"><div class="rail-title"><span class="live-dot"></span><h2>No radar</h2></div><p class="muted small">Seleção editorial · não é ranking de acessos</p>${trend.map((article, index) => `<a class="rail-item" href="${prefix}${href(article)}"><span class="rank">0${index + 1}</span><div>${badge(article)}<strong>${e(article.title)}</strong></div></a>`).join('')}<div class="rail-box"><span class="eyebrow">EXPLORE O FUTURO</span><h3>Seu próximo assunto está aqui.</h3><p>Encontre notícias por tema, palavra-chave e categoria.</p><a class="primary" href="${prefix}busca.html">Explorar notícias ↗</a></div></aside>`;

  if (out !== path.join(sourceRoot, 'public')) {
    const sourceAssets = path.join(sourceRoot, 'public/assets');
    if (fs.existsSync(sourceAssets)) fs.cpSync(sourceAssets, path.join(out, 'assets'), {recursive: true, force: true});
  }
  fs.mkdirSync(path.join(out, 'assets'), {recursive: true});
  for (const name of ['pulsobit-mark.svg', 'pulsobit-logo-dark.svg', 'pulsobit-logo-light.svg', 'pulsobit.css', 'favicon.svg']) {
    fs.copyFileSync(path.join(sourceRoot, 'brand', name), path.join(out, 'assets', name));
  }
  artwork(path.join(out, 'assets'));

  const side = articles.filter((article) => article.spotlight && article !== featured).slice(0, 2);
  write('index.html', page('Notícias de tecnologia, games e ciência', cfg.description, `<div class="wrap"><div class="ticker"><span class="ticker-label"><span class="live-dot"></span> NO RADAR</span><div class="ticker-links">${trend.map((article) => `<a href="${href(article)}">${e(article.tags[0])}</a>`).join('<span>•</span>')}</div><span class="edition">EDIÇÃO · ${e(displayDate(sorted[0].date).toUpperCase())}</span></div><section class="hero-grid" aria-label="Destaques">${hero(featured, './', true)}<div class="hero-side">${side.map((article) => hero(article, './')).join('')}</div></section>${ad('home')}<div class="main-grid"><section>${section('Últimas notícias', 'O QUE ESTÁ ACONTECENDO', 'busca.html')}<div class="chips">${Object.entries(categories).map(([key, value]) => `<a href="categorias/${key}.html">${e(value)}</a>`).join('')}</div><div class="cards">${sorted.slice(0, 8).map((article) => card(article, './')).join('')}</div></section>${rail('./')}</div><section class="topic-strip"><div><span class="eyebrow">CONHECIMENTO EM ÓRBITA</span><h2>Explore Ciência & Espaço</h2><p>Da Lua às descobertas que mudam nossa visão do universo.</p><a class="primary" href="categorias/espaco.html">Ver notícias ↗</a></div><img loading="lazy" src="assets/moon.svg" alt="Ilustração da Lua e de uma cápsula espacial"></section></div>`, {active: 'home', image: featured}));

  for (const [key, value] of Object.entries(categories)) {
    write(`categorias/${key}.html`, page(value, `Notícias, explicações e novidades sobre ${value}.`, `<div class="wrap listing"><nav class="crumb" aria-label="Trilha de navegação"><a href="../index.html">Início</a> / <span aria-current="page">${e(value)}</span></nav><div class="category-heading"><span class="eyebrow"><i></i> EDITORIAS</span><h1>${e(value)}<span>.</span></h1><p>Notícias, análises e explicações para acompanhar este universo.</p></div><div class="main-grid"><section><h2 class="visually-hidden">Notícias de ${e(value)}</h2><div class="result-line">${sorted.filter((article) => article.category === key).length} ${sorted.filter((article) => article.category === key).length === 1 ? 'matéria' : 'matérias'} <a class="more" href="../busca.html?categoria=${key}">Pesquisar nesta categoria ↗</a></div><div class="cards">${sorted.filter((article) => article.category === key).map((article) => card(article, '../')).join('')}</div></section>${rail('../')}</div></div>`, {p: '../', route: `categorias/${key}.html`, active: key, image: sorted.find((article) => article.category === key) || featured}));
  }

  write('busca.html', page('Buscar notícias', 'Explore as notícias por categoria e palavra-chave.', `<div class="wrap listing"><nav class="crumb" aria-label="Trilha de navegação"><a href="index.html">Início</a> / <span aria-current="page">Busca</span></nav><div class="category-heading"><span class="eyebrow"><i></i> ENCONTRE SEU ASSUNTO</span><h1>Buscar notícias<span>.</span></h1><p>Filtre por tema e descubra o que está acontecendo.</p></div><form id="filter" class="filters" role="search"><label>Palavra-chave<input id="q" name="q" type="search" placeholder="Ex.: GTA, NASA, inteligência artificial"></label><label>Categoria<select name="categoria" id="categoria"><option value="">Todas as categorias</option>${Object.entries(categories).map(([key, value]) => `<option value="${key}">${e(value)}</option>`).join('')}</select></label><label>Ordenar<select name="ordem" id="ordem"><option value="recentes">Mais recentes</option><option value="antigas">Mais antigas</option><option value="titulo">Título (A–Z)</option></select></label><button class="primary" type="submit">Buscar</button><button class="secondary" type="button" id="clear">Limpar</button></form><p id="result" aria-live="polite" class="result-line">${articles.length} matérias</p><h2 class="visually-hidden">Resultados da busca</h2><div id="results" class="cards search-cards">${sorted.map((article) => card(article, './')).join('')}</div><div id="empty" hidden class="empty"><h2>Nenhuma notícia encontrada.</h2><p>Tente outro termo ou selecione outra categoria.</p></div></div>`, {route: 'busca.html', search: true}));

  for (const article of articles) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.title,
      description: article.summary,
      datePublished: article.date,
      ...(article.updatedAt ? {dateModified: article.updatedAt} : {}),
      articleSection: categories[article.category],
      keywords: article.tags.join(', '),
      inLanguage: 'pt-BR',
      citation: article.sources.map((source) => source.url),
      image: [`${base}/${imageData(article).shareSrc || imageData(article).src}`],
      author: {'@type': 'Organization', name: cfg.name, url: `${base}/sobre.html`},
      publisher: {'@id': `${base}/#organization`},
      mainEntityOfPage: canonicalUrl(href(article)),
    };
    const related = sorted.filter((candidate) => candidate !== article).sort((left, right) => Number(right.category === article.category) - Number(left.category === article.category)).slice(0, 3);
    write(href(article), page(article.title, article.summary, `<div class="wrap article-wrap"><nav class="crumb" aria-label="Trilha de navegação"><a href="../index.html">Início</a> / <a href="../categorias/${article.category}.html">${e(categories[article.category])}</a> / <span aria-current="page">${e(article.title)}</span></nav><div class="article-head">${badge(article)}<h1>${e(article.title)}</h1><p class="dek">${e(article.summary)}</p><div class="byline"><span class="avatar">P.</span><div><a class="editorial-author" href="../sobre.html"><strong>${e(cfg.name)}</strong></a><span class="editorial-role">${e(article.editorial?.role || 'Edição institucional provisória')}</span><div class="editorial-dates"><span>Publicado em <time datetime="${article.date}">${displayDate(article.date)}</time></span>${article.updatedAt ? `<span>Atualizado em <time datetime="${e(article.updatedAt)}">${displayDate(article.updatedAt)}</time></span>` : ''}<span>${minutes(article)} min de leitura</span></div></div><button class="secondary share" id="share">Compartilhar ↗</button></div></div><figure class="article-figure">${img(article, '../', 'fetchpriority="high"', '(max-width:956px) calc(100vw - 32px), 900px')}<figcaption>${e(imageData(article).caption || 'Ilustração conceitual, não é registro do evento.')} Crédito: ${e(imageData(article).credit || cfg.name)}. ${imageData(article).sourceUrl ? `<a href="${e(imageData(article).sourceUrl)}" target="_blank" rel="noopener noreferrer">Origem</a> · <a href="${e(imageData(article).licenseUrl)}" target="_blank" rel="noopener noreferrer">Fundamento de uso</a>` : ''}</figcaption></figure><div class="article-grid"><article class="article-body">${article.eventDate ? `<p class="event-note">${e(article.eventLabel || 'Acontecimento')}: <time datetime="${article.eventDate}">${displayDate(article.eventDate)}</time>.</p>` : ''}${article.sections.map((item, index) => `<section><h2>${e(item.title)}</h2>${item.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`).join('')}</section>${index === 0 ? ad('article') : ''}`).join('')}${article.correctionNote ? `<aside class="editorial-note"><h2>Atualização e transparência</h2><p>${e(article.correctionNote)}</p>${article.verification ? `<p>Fontes verificadas em <time datetime="${e(article.verification.checkedAt)}">${displayDate(article.verification.checkedAt)}</time>. ${e(article.verification.method)}</p>` : ''}</aside>` : ''}<div class="sources"><h2>Fontes e referências</h2><ul>${article.sources.map((source) => `<li><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.name)} ↗</a>${source.checkedAt ? `<small>${e(source.kind || 'Fonte consultada')} · Consultada em <time datetime="${e(source.checkedAt)}">${displayDate(source.checkedAt)}</time>${source.publishedDate ? ` · Publicada na origem em ${displayDate(source.publishedDate)}` : ''}</small>` : ''}</li>`).join('')}</ul><p>${e(article.productionNote || 'Texto editorial com apoio de IA, baseado nas fontes indicadas.')} <a href="../editorial.html">Conheça nossos critérios.</a></p></div><div class="chips">${article.tags.map((tag) => `<a href="../busca.html?q=${encodeURIComponent(tag)}">${e(tag)}</a>`).join('')}</div>${ad('articleEnd')}</article>${rail('../')}</div><section>${section('Continue lendo', 'MAIS PARA EXPLORAR')}<div class="cards search-cards">${related.map((candidate) => card(candidate, '../')).join('')}</div></section></div>`, {p: '../', route: href(article), active: article.category, schema, image: article, published: article.date, modified: article.updatedAt}));
  }

  const institutional = {
    sobre: ['Sobre o PulsoBit', 'Somos um projeto editorial independente voltado a tecnologia, inteligência artificial, games, ciência, espaço e tendências. Nosso objetivo é explicar o que acontece e por que importa, com referências acessíveis e linguagem clara.', 'A identificação PulsoBit é institucional e provisória, não corresponde a um jornalista individual. Os textos e a consulta documental de fontes têm apoio de inteligência artificial. Não realizamos testes de produtos ou cobertura presencial nesta edição. Datas de publicação e atualização, referências e notas de correção aparecem nas matérias.'],
    editorial: ['Política editorial', 'Priorizamos fontes primárias, datas verificáveis e separação entre fatos, análises e projeções. Notícias devem conter referências; rumores não são apresentados como fatos.', 'A produção e a verificação documental têm apoio de IA e identificação institucional provisória. Conferimos as fontes indicadas e distinguimos declarações dos fornecedores de resultados independentes e recomendações editoriais. As matérias exibem datas, referências consultadas e notas das alterações relevantes. Fotografias de contexto, ilustrações conceituais, origem e fundamento de uso são identificados. O responsável editorial e o canal de contato ainda precisam ser formalmente definidos para a operação comercial. Publicidade permanece desativada e deve ser claramente separada do conteúdo se vier a existir.'],
    privacidade: ['Política de privacidade', 'Nesta versão, não há cadastro, rastreamento analítico ou anúncios ativos. O navegador pode armazenar a preferência de tema localmente. O servidor de hospedagem pode manter registros técnicos conforme suas próprias práticas.', 'Ao ativar publicidade ou ferramentas analíticas, o responsável pelo site deverá atualizar esta política, identificar o controlador e os prestadores de serviço, informar finalidades e bases legais, implementar mecanismos de consentimento quando aplicáveis e disponibilizar meios de exercício de direitos.'],
    contato: ['Contato e correções', cfg.contactEmail ? `Envie sugestões, dúvidas e solicitações de correção para ${cfg.contactEmail}.` : 'Canal de contato ainda não configurado. O responsável pelo portal deve definir um endereço de contato antes da publicação comercial.', 'Ao solicitar uma correção, indique a matéria, o trecho questionado e, se possível, uma referência que permita verificar a informação.'],
  };
  for (const [key, [title, ...paragraphs]] of Object.entries(institutional)) {
    write(`${key}.html`, page(title, paragraphs[0], `<div class="wrap listing institutional"><nav class="crumb" aria-label="Trilha de navegação"><a href="index.html">Início</a> / <span aria-current="page">${e(title)}</span></nav><span class="eyebrow">PULSOBIT</span><h1>${e(title)}<span>.</span></h1>${paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`).join('')}${key === 'contato' && cfg.contactEmail ? `<a class="primary" href="mailto:${e(cfg.contactEmail)}">Enviar e-mail</a>` : ''}</div>`, {route: `${key}.html`}));
  }

  const routes = [
    'index.html',
    ...Object.keys(categories).map((key) => `categorias/${key}.html`),
    ...articles.map(href),
    ...Object.keys(institutional).map((key) => `${key}.html`),
  ];
  write('robots.txt', cfg.indexing
    ? `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`
    : `User-agent: *\nDisallow: /\n# Pré-lançamento: indexação desativada pelo ambiente.\nSitemap: ${base}/sitemap.xml\n`);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => {
    const article = articles.find((candidate) => href(candidate) === route);
    return `<url><loc>${e(canonicalUrl(route))}</loc>${article ? `<lastmod>${e(article.updatedAt || article.date)}</lastmod>` : ''}</url>`;
  }).join('')}</urlset>`);
  write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><language>pt-BR</language><atom:link href="${e(base)}/rss.xml" rel="self" type="application/rss+xml"/><title>${e(cfg.name)}</title><link>${e(base)}/</link><description>${e(cfg.description)}</description>${sorted.map((article) => `<item><title>${e(article.title)}</title><link>${e(canonicalUrl(href(article)))}</link><guid>${e(canonicalUrl(href(article)))}</guid><description>${e(article.summary)}</description><category>${e(categories[article.category])}</category><media:content url="${e(base)}/${e(imageData(article).shareSrc || imageData(article).src)}" medium="image" type="image/jpeg" width="${imageData(article).width}" height="${imageData(article).height}"><media:credit>${e(imageData(article).credit || cfg.name)}</media:credit><media:description>${e(imageData(article).caption || 'Ilustração conceitual')}</media:description></media:content><dc:date>${e(article.date)}</dc:date>${article.date.includes('T') ? `<pubDate>${new Date(article.date).toUTCString()}</pubDate>` : ''}</item>`).join('')}</channel></rss>`);

  const htmlPages = fs.readdirSync(out, {recursive: true}).filter((file) => String(file).endsWith('.html')).length;
  return {
    environment: cfg.environment,
    siteUrl: base,
    basePath: cfg.basePath,
    output: path.relative(sourceRoot, out).split(path.sep).join('/') || '.',
    articles: articles.length,
    categories: Object.keys(categories).length,
    htmlPages,
    indexing: cfg.indexing,
    adsense: cfg.adsense.enabled,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = buildSite({environment: options.environment, output: options.output});
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
