# Pulso Digital — v1.0.1
Portal editorial estático, em português, com 8 matérias iniciais, 5 editorias e busca. Nome provisório: verificar disponibilidade de domínio e marca antes de publicar.

## Executar
- Para visualizar sem instalar nada, abra `public/index.html` no navegador após extrair o ZIP. Links e busca funcionam localmente.
- Para executar via HTTP (Node.js 18+): `npm start`, depois http://localhost:8080.
- Para regenerar páginas: `npm run build`. Para testar: `npm test`. Não há dependências npm.
- Hospedagem: publique **somente** a pasta `public/` em hospedagem estática. O servidor incluído é apenas para desenvolvimento local.

## GitHub Pages
- Repositório: https://github.com/jvt13/pulso-digital
- Portal: https://jvt13.github.io/pulso-digital/
- O workflow `.github/workflows/pages.yml` executa a geração existente e os testes com Node.js 24 antes de publicar exclusivamente `public/`. É acionado por push em `main` ou manualmente em Actions.
- A origem de publicação em Settings → Pages deve ser **GitHub Actions**. Não há domínio personalizado nem publicidade ativa.
- `config.json` contém a URL real, incluindo `/pulso-digital`, usada pelo gerador em canonical, Open Graph, NewsArticle, sitemap, RSS e robots.txt. CSS, JavaScript, imagens e navegação usam caminhos relativos.
- Relatórios e capturas operacionais ficam em `reports/`, ignorada pelo Git e fora do artefato publicado. Playwright foi usado apenas na homologação, sem adicionar dependências ao projeto.
- O `robots.txt` deste projeto é servido em `/pulso-digital/robots.txt`; regras para todo o host dependem do arquivo na raiz de `jvt13.github.io`. O sitemap está disponível em `/pulso-digital/sitemap.xml`.

## Configuração antes da publicação
1. Em `config.json`, defina `siteUrl` (URL HTTPS real, sem barra no fim) e `contactEmail`. Revise identificação do responsável, textos institucionais e privacidade conforme a operação real.
2. Execute `npm run build`. Isso gera canonical, Open Graph, NewsArticle, RSS e sitemap com a URL verdadeira. Envie o sitemap ao Search Console. As imagens atuais são SVG conceituais; para compartilhamento e Discover, adicione imagens JPEG/WebP licenciadas de alta resolução e ajuste os metadados e o gerador.
3. Revise as 8 matérias, confirme as fontes e publique conteúdo original adicional. Não há garantia de aprovação do AdSense ou de indexação.
4. Após aprovação e implementação de privacidade/consentimento conforme aplicável, informe o `client` real (ca-pub-...), os IDs numéricos `home`, `article`, `articleEnd` e altere `enabled` para true. Recompile. Não habilite sem política de privacidade adequada e gestão de consentimento; esta versão NÃO inclui CMP, Analytics ou anúncios ativos. Publique o ads.txt fornecido pela conta AdSense no diretório public.

## Organização
`content/articles.json`: fonte única das matérias, com slug, categoria, título, resumo, data de publicação, data do fato opcional, tags, imagem, seções e fontes. `src/build.mjs`: gerador. `src/art.mjs`: arte conceitual local. `public/assets`: CSS, JS e imagens. `public/`: saída pronta para servir.

## Automação futura (não implementada)
Google Trends Trending Now (RSS oficial, BR) -> normalizar pautas -> consultar fontes oficiais e independentes -> deduplicar -> gerar rascunho com contexto original -> verificar fatos, datas, direitos de imagem e qualidade -> revisão/aprovação -> persistir matéria -> build/test -> deploy. Implementar registro de fontes, auditoria, correções, limites, retentativas e rollback. Não republicar feeds ou artigos; usar tendências como sinal de interesse, não como fonte factual. A seleção “No radar” atual é editorial, não um ranking real.

Referências: https://support.google.com/trends/answer/3076011 ; https://support.google.com/adsense/answer/7299563 ; https://developers.google.com/search/docs/essentials/spam-policies
