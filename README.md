# Pulso Digital — v1.5.0
Portal editorial estático, em português, com 8 matérias iniciais, 5 editorias e busca. Nome provisório: verificar disponibilidade de domínio e marca antes de publicar.

## Executar
- Para visualizar sem instalar nada, abra `public/index.html` no navegador após extrair o ZIP. Links e busca funcionam localmente.
- Para executar via HTTP (Node.js 24+): `npm start`, depois http://localhost:8080.
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
- Groq é o provedor prioritário de redação; Gemini atua como revisor independente com `gemini-3.5-flash-lite`. Chamadas reais exigem confirmação explícita da modalidade gratuita e chave apenas no ambiente local ou `.env` ignorado. O mock é exclusivamente sintético e bloqueado para importação real.
- A homologação 1.4.1 limita cada requisição a 7.000 tokens reservados e mantém intervalo mínimo de 60 segundos entre chamadas, abaixo da referência pública de 8.000 tokens/minuto da Groq Free. O limite real da organização deve ser conferido na conta e nos cabeçalhos de resposta; sem conta Free confirmada não há chamada real.
- Dossiês, tentativas de IA, rascunhos e imagens preparadas ficam em `newsroom/data/`, ignorado pelo Git. O newsroom não aprova nem publica notícias. O portal e as oito matérias permanecem inalterados.
- A redação 2.0 usa taxonomia factual aditiva 1.1: fato documentado, declaração atribuída, expectativa, rumor e opinião. Título e resumo exigem evidência própria; fatos numéricos não podem ser classificados como opinião.
- Evidências guardam até 600 caracteres, papel editorial e indicação de truncamento. O `Editorial Quality Score` determinístico é auxiliar, expõe cobertura/limitações e não certifica fatos nem autoriza publicação.
- `enrich`, `revise` e `quality` permitem atualizar evidências, revisar um rascunho sem trocar seu ID e consultar o score. Imagens próprias podem ser autorizadas no manifesto, mas elementos de terceiros exigem fundamento específico.
- `review`, `review-status` e `review-history` permitem uma revisão semântica independente no Gemini, vinculada ao hash de texto, título, resumo, claims e evidências. O contexto usa janelas relevantes por claim, informa omissões e bloqueia chamada quando a cobertura necessária é insuficiente. O resultado é privado, não aprova e não publica.
- Gemini usa `gemini-3.5-flash-lite` em modalidade gratuita, com orçamento separado por tarefa, sem grounding, ferramentas ou fallback pago.
- A redação usa transporte compacto 2.0: claims não repetem o texto dos parágrafos, evidências usam aliases reversíveis e slug/categoria/classificação são reconstruídos localmente antes da validação. `reasoning_effort: low` é configurável e continua contabilizado na saída.
- Erros de IA são classificados por tipo (schema, truncamento, JSON, timeout, limite, autenticação, falha transitória e orçamento) com ação recomendada; não há repetição automática. A pré-checagem exige saldo também para a revisão posterior.

## Armazenamento criptografado
- `npm run storage -- help` apresenta checkpoint, verificação, métricas, restauração isolada e gestão de chave. Arquitetura e estratégia de nuvem: [storage/README.md](storage/README.md).
- SQLCipher (`better-sqlite3-multiple-ciphers@13.2.0`, MIT) mantém checkpoints `storage/data/` criptografados em repouso. Após a ativação, o banco operacional é a fonte de verdade; os JSON permanecem apenas como material legado de recuperação.
- A chave `PULSO_STORAGE_KEY` fica apenas no ambiente ou `.env` ignorado. Sem a chave ou backup válido, o snapshot não é recuperável.
- O storage não substitui os motores atuais, não acessa IA, não aprova, não publica e não inclui `.env`, credenciais ou `.git` no checkpoint.

## SQLite operacional
- A versão 1.4.6 adiciona `storage/data/operational.sqlcipher`, banco SQLCipher separado dos snapshots, com estados canônicos do radar, newsroom, editorial, consumo, revisões e assets privados.
- A ativação é explícita: `storage migrate --dry-run`, `storage migrate`, `storage compare` e `storage activate`. O marcador assinado `storage/data/operational.json` define o backend ativo; os JSON permanecem como material legado de recuperação e não são mais escritos.
- `storage backup`/`checkpoint` geram snapshots consistentes a partir do banco ativo; `storage status`, `storage metrics --json` e `storage verify` refletem o backend operacional.
- Nenhuma chamada de IA, aprovação, publicação, mudança de design ou configuração de VPS é feita pela camada de armazenamento.

## Automação editorial
- `npm run automation -- help` apresenta o orquestrador persistente, `status`, `plan`, `run --once`, `run --dry-run`, `start`, `pause`, `resume`, `jobs`, `history`, `health` e `metrics`.
- A automação inicia pausada. O padrão não executa IA real (`ai.enabled=false`). A PD-006.6
  executou chamadas reais dentro dos limites autorizados e preservou os resultados privados;
  qualquer nova chamada exige tarefa e autorização próprias.
- Agendas padrão: radar a cada 30 minutos, seleção a cada 120 minutos, health a cada 5 minutos e backup a cada 24 horas. Execuções atrasadas são consolidadas, sem disparar todos os horários perdidos.
- Leases no SQLite impedem duas instâncias concorrentes, com renovação automática, fencing nas
  gravações e bloqueio explícito de proprietários expirados. Execuções atrasadas por mais de
  24 horas são consolidadas em uma única recuperação por atividade.
- O pipeline usa os motores existentes, reutiliza rascunhos já gerados e importa somente
  rascunhos privados. Uma política de elegibilidade verifica revisão semântica, imagem,
  evidência, integridade e aprovação, mas não aprova nem publica.
- A migration v5 adiciona `automation_schedules`, `automation_runs`, `automation_jobs`, `automation_steps`, `automation_events` e `automation_control`; use `npm run storage -- upgrade` para aplicar migrations ao banco operacional ativo.

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

## Automação editorial supervisionada
O orquestrador da versão 1.5.0 coordena radar, seleção, pesquisa, evidências, redação, validação determinística, revisão independente, preparação de imagem, importação privada e elegibilidade de publicação. A automação inicia pausada, não aprova, não publica e mantém a IA real desativada por padrão. Resultados de revisão `changes-required`, imagem pendente ou aprovação ausente bloqueiam publicação. Não republicar feeds ou artigos; usar tendências como sinal de interesse, não como fonte factual. A seleção “No radar” atual é editorial, não um ranking real.

### Publicação controlada

- `manual` é o padrão e exige aprovação humana explícita.
- `assisted` prepara e enfileira a matéria, sem publicar.
- `autonomous-controlled` existe somente como avaliação simulada nesta versão.
- Risco editorial, fonte única, rumores, citações extensas, direitos, qualidade, atualidade,
  duplicidade, limites diários/categoria e circuit breaker são avaliados separadamente.
- Nenhuma decisão automatizada é registrada como aprovação humana.
- Critérios completos: [docs/publication-policy.md](docs/publication-policy.md).

## Relatórios

A estrutura e a retenção dos artefatos privados estão em
[docs/report-retention.md](docs/report-retention.md). `project-status.md` é a visão
consolidada; `report.md` descreve apenas a tarefa atual.

Referências: https://support.google.com/trends/answer/3076011 ; https://support.google.com/adsense/answer/7299563 ; https://developers.google.com/search/docs/essentials/spam-policies
