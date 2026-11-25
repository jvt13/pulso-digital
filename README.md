# Pulso Digital — v1.4.0
Portal editorial estático, em português, com 8 matérias iniciais, 5 editorias e busca. Nome provisório: verificar disponibilidade de domínio e marca antes de publicar.

## Executar
- Para visualizar sem instalar nada, abra `public/index.html` no navegador após extrair o ZIP. Links e busca funcionam localmente.
- Para executar via HTTP (Node.js 18+): `npm start`, depois http://localhost:8080.
- Para regenerar páginas: `npm run build`. Para testar: `npm test`. Execute antes `npm ci --ignore-scripts` para instalar o parser XML fixado do radar.
- Hospedagem: publique **somente** a pasta `public/` em hospedagem estática. O servidor incluído é apenas para desenvolvimento local.

## Motor editorial local
- A CLI está disponível em `npm run editorial -- help`. Contratos, fluxo, validações, imagens, deduplicação e recuperação estão documentados em [editorial/README.md](editorial/README.md).
- Entradas manuais ficam em `editorial/data/incoming/`; rascunhos, histórico, aprovações e backups permanecem em `editorial/data/`, ignorado pelo Git. Somente fixtures sintéticas e configuração não sensível são versionadas.
- Publicação exige validação e aprovação explícita do operador, incluindo fatos e direitos da imagem, vinculada ao hash do material aprovado. `publish --dry-run` gera e confere uma cópia temporária sem efeitos persistentes na raiz.
- O motor editorial não consulta IA, notícias ou Trends e não possui aprovação automática, agendamento, auto-commit, push ou deploy. O build normal não promove rascunhos. Fixtures são bloqueadas para publicação na raiz real; o ciclo de testes é executado exclusivamente em cópias isoladas.
- `npm test` mantém as oito verificações anteriores e executa a suíte editorial com os recursos nativos do Node.js em Windows/Linux.

## Radar privado de pautas
- `npm run radar -- help` apresenta os comandos de coleta, classificação, Pulso Score, fila e exportação. Configuração, fontes, fórmula e limites: [radar/README.md](radar/README.md).
- `top --mode trends` exige volume aproximado efetivamente fornecido pelo feed; `top --mode editorial` ordena potencial editorial de acontecimentos específicos sem afirmar demanda de busca. `reclassify --dry-run` mostra a migração das regras antes de `reclassify`. O export legado continua no contrato de pauta 1.0; os novos modos oferecem contrato 1.1. O contrato do motor editorial permanece 1.0.
- Google Trends BR/US e feeds oficiais complementares produzem candidatos para pesquisa. O radar não redige, aprova, publica ou importa automaticamente pautas no motor editorial.
- Godot Blog, Google AI e Google Research ampliam os sinais de games e IA. A [revisão de fontes](radar/source-review.md) documenta os endpoints e as decisões de ativação; Microsoft Blog e Xbox Wire permanecem inativos.
- Dados, cache, fila e históricos ficam em `radar/data/`, ignorado pelo Git. A coleta é manual, sem agendamento. Fixtures sintéticas entram somente nos testes.
- O radar usa `sax@1.4.3` para XML estrito. O lockfile fixa também o parser HTML do newsroom; o build do portal continua usando somente Node.js.

## Newsroom privado de pesquisa e redação
- `npm run newsroom -- help` apresenta seleção, pesquisa, dossiês, redação, verificação, imagem, consumo e importação de **rascunhos privados**. Configuração e limites: [newsroom/README.md](newsroom/README.md).
- Pesquisa usa referências originais do radar e URLs adicionais explicitamente autorizadas, com HTTPS, hosts permitidos, proteção de DNS, `robots.txt` e extração curta de HTML por `parse5@7.3.0`. Não há busca automática por Google Search, nem reprodução integral de textos.
- Groq é o provedor prioritário configurável; Gemini permanece alternativa sem modelo pré-selecionado. Chamadas reais exigem confirmação explícita da modalidade gratuita e chave apenas no ambiente local ou `.env` ignorado. O mock é exclusivamente sintético e bloqueado para importação real.
- Dossiês, tentativas de IA, rascunhos e imagens preparadas ficam em `newsroom/data/`, ignorado pelo Git. O newsroom não aprova nem publica notícias. O portal e as oito matérias permanecem inalterados.

## GitHub Pages
- Repositório: https://github.com/jvt13/pulso-digital
- Portal: https://jvt13.github.io/pulso-digital/
- O workflow `.github/workflows/pages.yml` executa a geração existente e os testes com Node.js 24 antes de publicar exclusivamente `public/`. É acionado por push em `main` ou manualmente em Actions.
- A origem de publicação em Settings → Pages deve ser **GitHub Actions**. Não há domínio personalizado nem publicidade ativa.
- `config.json` contém a URL real, incluindo `/pulso-digital`, usada pelo gerador em canonical, Open Graph, NewsArticle, sitemap, RSS e robots.txt. CSS, JavaScript, imagens e navegação usam caminhos relativos.
- Relatórios e capturas operacionais ficam em `reports/`, ignorada pelo Git e fora do artefato publicado. Playwright foi usado apenas na homologação, sem adicionar dependências ao projeto.
- O `robots.txt` deste projeto é servido em `/pulso-digital/robots.txt`; regras para todo o host dependem do arquivo na raiz de `jvt13.github.io`. O sitemap está disponível em `/pulso-digital/sitemap.xml`.

## Configuração antes da publicação
### Padrão editorial e imagens
- `content/articles.json` preserva os campos legados (`date`, `eventDate`, `category`, `tags`, `summary`, `image`, `sources`). As revisões acrescentam `updatedAt`, `eventLabel`, `editorial`, `verification` e `correctionNote`. `date` é a publicação original; `updatedAt` só muda quando há revisão efetiva, sem inventar horário para datas históricas. O gerador não atualiza datas de revisão automaticamente.
- Cada fonte contém URL, identificação e `checkedAt`; `publishedDate` é informado quando confirmado. A identificação é institucional provisória, com apoio de IA explicitado. Não há jornalistas fictícios, testes de produtos ou cobertura presencial atribuídos a pessoas.
- `content/images.json` registra arquivos locais, texto alternativo, legenda, crédito, origem, autorização e processamento. As sete artes conceituais próprias foram preservadas, com rasterização vetorial em WebP (1600/640 px) e JPEG de compartilhamento (1600 px). A foto da Orion é da Artemis I em 20/11/2022, usada como contexto e identificada como tal, conforme permissão editorial da NASA.
- Os bitmaps e seus dados de origem são versionados. O build não baixa imagens nem exige ferramentas externas: usa os arquivos locais existentes e continua gerando as artes vetoriais de `src/art.mjs`. Ao substituir uma imagem, confirme a autorização, preserve o original quando permitido e gere variantes sem ampliar bitmaps pequenos, atualizando o registro de dimensões e tamanhos. Ferramentas de conversão usadas na homologação foram temporárias, sem dependências npm permanentes.
- Metadados incluem Twitter Cards, Open Graph e JPEG correspondente à imagem visível; NewsArticle e breadcrumbs refletem as informações publicadas. Sitemap utiliza a atualização efetiva e RSS inclui categoria, imagem e crédito. A busca permanece `noindex,follow`; permissões das imagens permitem `max-image-preview:large` nas demais páginas.
- A presença de metadados e imagens grandes não garante indexação ou inclusão no Discover. Lighthouse mede condições de laboratório; resultados e evidências operacionais ficam em `reports/`, fora do Git e do portal.

### Antes da operação comercial
1. Em `config.json`, defina `siteUrl` (URL HTTPS real, sem barra no fim) e `contactEmail`. Revise identificação do responsável, textos institucionais e privacidade conforme a operação real.
2. Execute `npm run build`. Isso gera canonical, Open Graph, Twitter Cards, NewsArticle, breadcrumbs, RSS e sitemap com a URL verdadeira. O registro de imagens fornece WebP responsivo e JPEG para compartilhamento, com créditos e fundamento de uso. Uma eventual submissão do sitemap ao Search Console exige tarefa própria; ela não foi realizada nesta entrega.
3. As oito matérias foram revisadas documentalmente na PD-002. Mantenha a conferência de fontes, datas e condições de uso a cada revisão, registrando alterações relevantes. Não há garantia de indexação ou de inclusão no Discover.
4. Após aprovação e implementação de privacidade/consentimento conforme aplicável, informe o `client` real (ca-pub-...), os IDs numéricos `home`, `article`, `articleEnd` e altere `enabled` para true. Recompile. Não habilite sem política de privacidade adequada e gestão de consentimento; esta versão NÃO inclui CMP, Analytics ou anúncios ativos. Publique o ads.txt fornecido pela conta AdSense no diretório public.

## Organização
`content/articles.json`: fonte única das matérias, com slug, categoria, título, resumo, data de publicação, data do fato opcional, tags, imagem, seções e fontes. `src/build.mjs`: gerador. `src/art.mjs`: arte conceitual local. `public/assets`: CSS, JS e imagens. `public/`: saída pronta para servir.

## Automação futura (não implementada)
Google Trends Trending Now (RSS oficial, BR) -> normalizar pautas -> consultar fontes oficiais e independentes -> deduplicar -> gerar rascunho com contexto original -> verificar fatos, datas, direitos de imagem e qualidade -> revisão/aprovação -> persistir matéria -> build/test -> deploy. Implementar registro de fontes, auditoria, correções, limites, retentativas e rollback. Não republicar feeds ou artigos; usar tendências como sinal de interesse, não como fonte factual. A seleção “No radar” atual é editorial, não um ranking real.

Referências: https://support.google.com/trends/answer/3076011 ; https://support.google.com/adsense/answer/7299563 ; https://developers.google.com/search/docs/essentials/spam-policies
