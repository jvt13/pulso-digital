# Radar de pautas — contratos 1.0 e 1.1

O radar lê feeds públicos explicitamente configurados, classifica sinais e cria uma fila privada para pesquisa. Não escreve matérias, afirmações verificadas, autorização de imagens ou aprovações. Não importa no motor editorial, não publica, não executa Git/deploy e não é agendado pelo Actions.

## Instalação e arquitetura

Use Node.js 18+ e `npm ci --ignore-scripts`. A dependência única `sax@1.4.3` é fixada no lockfile, sem dependências transitivas, licença BlueOak-1.0.0. É usada somente no radar, para parsing XML estrito. O gerador estático e o motor editorial continuam sem dependências externas próprias. A inclusão de um parser consolidado evita implementar XML com expressões regulares. Consulte a licença em `node_modules/sax/LICENSE.md` e o projeto [sax-js](https://github.com/isaacs/sax-js). `npm audit` deve ser reavaliado antes de atualizações.

Módulos separados em `src/radar/`: CLI; engine (orquestração); collector (cache/retry); security (host/DNS/transporte HTTPS); xml (limites e SAX); providers/google-trends e rss; normalizer; classifier; scorer; deduplication; contract; repository. Os módulos auxiliares security/xml/contract separam limites de confiança e o contrato exportado. Apenas as primitivas de caminhos e gravação segura do motor editorial são reutilizadas; seu contrato e suas regras de aprovação não mudam.

`radar/config.json` contém limites/regras/pesos não sensíveis. `sources.json` contém endereços, hosts permitidos, categoria sugerida, idioma, região, peso, organização, status e referências de condições de uso. Alterações nessas listas exigem verificação humana da legitimidade do feed, das condições e do destino antes de ativação. Novos países usam outra entrada explícita, com região e `geo` adequados. Somente BR/US estão habilitados.

## Fontes e condições

- Google Trends BR/US: `https://trends.google.com/trending/rss?geo=BR` e `?geo=US`. O [suporte oficial](https://support.google.com/trends/answer/3076011) oferece exportação RSS; [orientação Search Central](https://developers.google.com/search/docs/monitor-debug/trends-start) e [termos Google](https://policies.google.com/terms) foram consultados. Não é a [API Alpha](https://developers.google.com/search/apis/trends); nenhum acesso Alpha foi solicitado.
- NASA News e Technology: feeds ligados na [página oficial RSS](https://www.nasa.gov/rss-feeds/), com [condições de mídia](https://www.nasa.gov/nasa-brand-center/images-and-media/). São a mesma organização; não contam como confirmação independente.
- Google The Keyword: RSS ligado no [blog oficial](https://blog.google/), sujeito aos termos Google. É sinal do próprio fabricante, sem pressupor independência.
- Microsoft Blog e Xbox Wire: endpoints responderam HTTP 200 na verificação, mas estão **inativos** por cautela com a restrição de uso pessoal/não comercial dos [termos gerais Microsoft](https://www.microsoft.com/en-us/legal/terms-of-use). Reavaliar autorização específica antes de ativar. Não foram presumidos autorizados para uso comercial irrestrito.

Além de NASA News, NASA Technology e Google Blog, foram ativados Godot Blog, Google AI e Google Research na PD-004.1. Condições, endpoints verificados e decisões de rejeição: [source-review.md](source-review.md). Não há obrigação de obter sinais de todas as editorias em toda coleta. Consultar RSS para sinais privados não autoriza republicação de textos, imagens ou marcas. O parser retém título, URL, identificador, data e metadados de pauta; descrições/corpos que venham no RSS são ignorados. Links de notícia e imagem nunca são seguidos pelo coletor.

## Rede, XML e cache

Produção aceita somente HTTPS/443, sem credenciais, IP literal ou fragmentos, em hosts exatos da fonte. Não usa proxy de ambiente, cookies ou autenticação. DNS é resolvido em cada tentativa/redirecionamento; todos os endereços retornados precisam ser públicos. A conexão fixa um endereço validado via lookup próprio, desativa reuso de agente e mantém hostname/SNI e validação TLS normais. Isso evita uma segunda resolução entre validação e conexão. Redes privadas, loopback, link-local, metadados, multicast, documentação, tradução/túneis e outras faixas especiais são recusadas conservadoramente. Consulte os registros [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) e [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/). Hosts com resposta DNS mista pública/privada são recusados.

Padrões: timeout 15 segundos por fase DNS/resposta; até 1 MiB de XML, 3 redirects, 2 conexões simultâneas, 2 retries transitórios; backoff 1/2 segundos. HTTP 429/5xx respeitam o maior entre backoff e Retry-After. Esperas de mais de 30 segundos são registradas como cooldown para futura execução; nunca reduzidas para forçar uma tentativa. Falha de fonte é isolada e registrada. Requisições pedem `Accept-Encoding: identity`; compressão inesperada é recusada em vez de aceitar bombas descomprimidas. Respostas não 200 não têm corpo baixado integralmente.

SAX é usado em modo estrito, namespaces por URI, CDATA, entidades XML predefinidas/numéricas e UTF-8 estrito. DTD, entidades customizadas/externas e processing instructions externas são proibidos. Limites padrão: profundidade 32, 40000 nós, 100 itens/feed, 1000 caracteres por campo. Entidades HTML não padronizadas em XML não são silenciosamente aceitas; devem vir em CDATA/escape válido. HTML eventual de títulos é reduzido a texto, nunca executado.

Intervalo mínimo e TTL padrão: 15 minutos. O `max-age` maior do servidor é respeitado; `no-cache` exige revalidação quando o intervalo permite; `no-store` impede guardar cache HTTP. Trends retornou no-store na homologação: permanecem as observações operacionais normalizadas, não um cache de resposta para replay. Consultas antes do intervalo são deferred quando não há cache. Não há opção force para burlar o intervalo.

O cache armazena apenas campos de sinal normalizados, ETag e Last-Modified, não o corpo bruto. HTTP 304 revalida os mesmos dados e atualiza observedAt, conservando collectedAt original. Cache fresco/stale é explicitamente identificado, preservando o instante original; replay não cria observação nova nem renova lastSeenAt. Em falha, cache de até um dia pode ser usado como stale com erro explícito. Dados além do máximo stale não são reaproveitados. Não se trata cache como coleta fresca.

## Contrato de pautas

`schemas/topic-v1.schema.json`, `schemaVersion: "1.0"`, independente do envelope editorial. Campos: id determinístico; topic/normalizedTopic; suggestedCategory ou null fora do escopo; relatedTerms; signals; sourceReferences; firstSeenAt/lastSeenAt/collectedAt; score/scoreBreakdown/priority; status; classificationReason/classificationSignals; duplicateReferences; researchQueries. History fica no registro privado e é omitido do export. O módulo contract valida invariantes operacionais, não é um validador JSON Schema genérico.

`schemas/topic-v1.1.schema.json` acrescenta, sem modificar o contrato 1.0, `candidateType`, `specificity`, `ruleVersion`, `assessmentHash`, `assessmentAt`, `pulsoTrends` e `pulsoEditorial`. O snapshot aceita registros 1.0 e 1.1 durante a migração; o comando `fetch` exige reclassificação explícita dos registros antigos antes de coletar. `score`, `scoreBreakdown` e `priority` mantêm o cálculo Pulso Score original. `legacyAssessment` preserva a avaliação registrada antes da migração. Export sem `--mode` continua 1.0, com a lista original de campos; `--mode trends` e `--mode editorial` produzem export 1.1 por padrão. `--schema-version 1.0` pode ser solicitado no modo legado. O envelope editorial 1.0 não foi alterado. Saídas de export são pautas para pesquisa, nunca notícias prontas.

Cada sinal preserva provedor, organização, região, idioma, peso, originalId quando disponível, URL do feed, URL do item, data informada pelo feed, volume aproximado literal, termos/notícias relacionados disponibilizados, coleta real, observação e modo/cache. Não há ID original inventado: na ausência, originalId é null e uma chave técnica separada é calculada. A data do feed não comprova início da tendência nem data do acontecimento. Ausências permanecem null/lista vazia.

Estados: new (candidato ainda não selecionado), queued (seleção manual para pesquisa), deferred (adiado explicitamente), dismissed (descartado por regra ou operador com motivo). O operador pode selecionar novamente uma pauta; cada mudança fica no histórico com identidade técnica operador-local e não inventa nome de responsável. Nenhum desses estados é aprovação editorial.

## Classificação e deduplicação

Usam-se os IDs existentes: tecnologia, ia, games, espaco e tendencias. Regras configuráveis em português/inglês: palavras/frases com limites de palavra, aliases, pesos e termos negativos. Na versão de regras 1.1.0, entidade + produto/API/versão/contexto técnico corrigem falsos negativos sem promover nomes isolados de organizações. Feed fornece contexto fraco (+1), ou contexto explícito de IA/games para regras ancoradas em entidades presentes no título. Referências/termos relacionados fornecidos pelo feed podem contribuir, mas não criar entidade ausente do título. Termos, versões, regras e contexto usados ficam registrados. O mínimo continua 2 pontos e exige sinal substantivo; organização fraca + bônus de feed sozinho não basta. Gemini/Claude/Steam/Windows/Apple sem contexto continuam protegidos, assim como Claude Monet, apple pie e steam engine.

Assunto sem contexto recebe categoria null e dismissed com justificativa, nunca Tendências como fallback. Futebol/política/celebridades não são promovidos só por popularidade. Uma conexão textual explícita com uma editoria pode ser mantida, com relevância reduzida pela metade quando coexistem termos fora do escopo. Ainda exige pesquisa humana.

O tipo do candidato é `specific-event`, `possible-update`, `broad-topic` ou `insufficient-context`. Entidades genéricas conhecidas, como `nasa`, são temas amplos: ficam disponíveis para descoberta com `discoveryCategory`, sem competir no ranking editorial. Entidade ambígua isolada continua sem categoria. A identificação de acontecimento específico exige título contextualizado; não inventa fato. Comunicados administrativos reconhecidos recebem teto de relevância e ficam fora da fila editorial. As regras são heurísticas léxicas configuráveis: uma correspondência não verifica fato, relevância definitiva ou direitos de uso.

Normalização: caixa, NFD/acentos, pontuação e espaços. URLs removem fragmentos/rastreamento e ordenam parâmetros, mantendo semântica do caminho. Uma mesma identidade de item/provedor/região atualiza a pauta existente. URL canônica idêntica de item RSS também consolida. Entre origens, termo/título normalizado exato requer datas de feed próximas (até 72 h); similaridade Jaccard >=0,88 exige ao menos cinco palavras, os mesmos tokens numéricos e janela temporal. O link genérico do feed Trends não consolida todas as tendências. Produto/empresa compartilhados isoladamente não são critério de fusão. Sem datas suficientes, a consolidação entre fontes é conservadora.

O acervo content/articles.json é somente lido. Título exato vira published-exact; título semelhante ou referência de fonte em comum vira possible-update, com motivo. Fonte compartilhada não prova duplicidade, nem novidade de título prova originalidade. Acontecimentos distintos sobre a mesma empresa devem continuar separados. O algoritmo simples tem falsos positivos/negativos e não traduz títulos.

## Pulso Score

Para componentes normalizados r,p,a,o,n entre 0 e 1:

```text
S = round(100 × (30r + 25p + 20a + 15o + 10n)) / 100
```

Os pesos são configuráveis e devem totalizar 100. Cada componente retorna value (ou null), reason, weight e points. Cobertura é a soma dos pesos dos componentes disponíveis, de 0 a 100. **Pesos ausentes não são redistribuídos**: contribuem zero pontos, mas são registrados como desconhecidos. Não se afirma desinteresse quando um feed especializado não informa volume; existe menor cobertura. Esta política conservadora não promove artificialmente a ausência de dados. Uma pauta sem volume, com todos os outros componentes máximos, chega a 75, e pode ser relevante mesmo sem prioridade alta.

- r: min(1, peso da melhor regra/5), com penalidade 0,5 para conexão mista fora do escopo. Sem classificação, r=0.
- p: faixa ordinal do volume aproximado literal. Pisos de 1 milhão/100 mil/10 mil/1 mil/abaixo disso correspondem a 1/0,8/0,6/0,4/0,2. Notações +, K, mil, M e separadores usuais são tratadas apenas para escolher a faixa; o valor bruto permanece no sinal. Formatos desconhecidos ficam indisponíveis. Para mais de uma região usa-se a maior faixa individual, sem somar BR/US e sem comparar contagens exatas entre países. Não é percentil regional nem estimativa exata.
- a: 2^(-horas/48), usando a data de feed válida mais recente não futura. Não substitui data ausente pela coleta. É atualidade do sinal, não certificação de quando aconteceu o fato.
- o: maior peso configurado de provedor. Duplicar feeds/organizações não aumenta o componente e não pressupõe independência.
- n: 0 se título publicado exato; 0,4 para possível atualização; 1 caso contrário. Relativo somente ao acervo local, sem certificar originalidade.

Alta: >=80; média: >=60 e <80; baixa: <60. Limiares configuráveis, usados com casas decimais. Pontuação alta não verifica notícia nem autoriza imagem/publicação. As regras são uma primeira heurística auditável, não previsão de audiência.

### Pulso Trends e Pulso Editorial

O Pulso Trends apresenta exatamente a fórmula, os componentes e a cobertura do Pulso Score original. Apenas pautas com popularidade aproximada válida **efetivamente fornecida** pelo feed, conexão editorial ou tema amplo conhecido e sem duplicidade publicada exata entram em `top --mode trends`. Volume literal (`10.000+`, por exemplo) permanece aproximado; países não são somados. Um tema amplo pode aparecer nesse ranking como sinal de descoberta, com seu tipo visível.

O Pulso Editorial usa os mesmos componentes não populares, sem inferir demanda de busca:

```text
E = round(100 × (30r + 20a + 15o + 10n) / 75, 2)
cobertura = 100 × soma dos pesos disponíveis entre {30,20,15,10} / 75
```

O denominador 75 é fixo. Componente ausente contribui zero e reduz a cobertura; não há redistribuição. Limites: alta >=80, média >=60, baixa <60. Para **alta** também são exigidos acontecimento específico ou possível atualização, relevância >=0,8, data válida do feed nas últimas 48 horas, origem identificada com peso >=0,8, cobertura 100%, ausência de duplicidade exata e ausência de caráter administrativo. Se a nota atinge 80 sem esses requisitos, a prioridade apresentada fica em média e os motivos são listados. Esses limites são conservadores para impedir alta a partir de termo genérico, fonte fraca ou data ausente. `top --mode editorial` inclui apenas candidatos específicos, com categoria, dentro de 168 horas, e ordena o potencial editorial; não afirma popularidade, verdade factual nem receita. As janelas e os limiares ficam em `radar/config.json`.

Os indicadores são recalculados somente na leitura para refletir o envelhecimento do sinal; o `score` registrado e seu histórico não são regravados por uma simples consulta. Por isso, um Pulso Trends exibido mais tarde pode divergir da pontuação histórica registrada. `calculatedAt` e `assessmentAt` distinguem os instantes. A reclassificação explícita atualiza a avaliação persistida, sem criar observações de feed.

## Armazenamento, retenção e recuperação

Tudo operacional fica em radar/data/, ignorado pelo Git: state.json, lock/owner e eventuais registros de recuperação. Cache normalizado, pautas, histórico, cooldowns e resumos de execuções integram **um único snapshot JSON**. Cada alteração é gravada em temporário no mesmo diretório, fsync e rename, sob mkdir exclusivo de lock. Falha antes do rename preserva snapshot anterior; após rename o novo snapshot inteiro é visível. Não existe transação distribuída ou escrita parcial de fila/cache/histórico separados. Leitura vê o último snapshot completo e não cria diretórios. Alteração externa durante coleta/dry-run invalida o resultado por fingerprint. Não edite arquivos enquanto uma operação estiver ativa.

Lock órfão exige `radar recover --reason ...`; só é removido se proprietário no mesmo host está comprovadamente morto, ou se ficou sem owner após interrupção. Lock ativo/de outro host não é removido. O registro de recuperação é privado. Garantias de fsync/rename dependem do sistema de arquivos; não há promessa contra falha elétrica real ou administrador hostil.

`radar reclassify --dry-run` compara o snapshot com as regras atuais em memória e informa mudanças sem gravar estado, cache, lock ou histórico. `radar reclassify` usa o lock existente, preserva IDs, datas, sinais, referências, histórico e decisões manuais. Descarte de origem `operator` ou desconhecida não é reaberto; descarte atribuído a `radar-regras` pode voltar a `new` se a regra contextual justificar. O hash da avaliação evita regravação em repetições idênticas. Antes de substituir o snapshot, a operação grava em `radar/data/backups/` uma cópia exata do estado anterior e um recibo com hashes anterior/posterior. `radar restore --backup ID --reason "..." --dry-run` verifica a recuperação; sem `--dry-run`, restaura apenas se o estado atual ainda corresponder ao hash posterior do recibo. A restauração também salva backup do estado que substitui. Assim, uma alteração posterior do operador bloqueia restauração acidental. Arquivos temporários/recibos remanescentes após interrupção devem ser auditados; o rename do snapshot é a fronteira de visibilidade, sem alegar transação atômica entre arquivos de backup e estado. Não remova backups sem política operacional explícita.

Retenção padrão de 90 dias é uma janela de trabalho: top/export não incluem pautas antigas, mas list/show/history preservam registros. Status/fetch informam IDs elegíveis para arquivamento **manual**. Não há exclusão/limpeza implícita. Limites: 2000 pautas, 200 eventos por pauta, 200 execuções, snapshot 32 MiB. Ao atingir limite, a operação falha preservando o anterior; planeje cópia/arquivamento explícito sob manutenção e com backup, sem editar durante coleta. Não foi implementado um comando de exclusão. A retenção não é garantia de eliminação de dados privados; o operador controla backups e acesso.

## CLI

```bash
npm run radar -- help
npm run radar -- sources
npm run radar -- fetch
npm run radar -- fetch --region BR
npm run radar -- fetch --dry-run
npm run radar -- list --category games
npm run radar -- list --min-score 60
npm run radar -- top --limit 10
npm run radar -- top --mode trends --limit 10
npm run radar -- top --mode editorial --category games --limit 10
npm run radar -- list --category ia
npm run radar -- reclassify --dry-run --json
npm run radar -- reclassify --json
npm run radar -- restore --backup ID --reason "Recuperação autorizada" --dry-run
npm run radar -- show ID
npm run radar -- queue ID
npm run radar -- dismiss ID --reason "Sem conexão editorial demonstrável"
npm run radar -- defer ID --reason "Aguardar informação oficial"
npm run radar -- history ID
npm run radar -- status
npm run --silent radar -- export --limit 10 --json
npm run --silent radar -- export --mode editorial --limit 5 --json
npm run --silent radar -- export --mode trends --limit 5 --json
```

`--root` seleciona outra cópia do projeto. `--json` oferece resultado estruturado; `npm run --silent` evita cabeçalho do npm. `--mode legacy` é o padrão para preservar os consumidores anteriores; `--mode trends|editorial` escolhe os novos rankings e filtros. Export retorna apenas pautas para futura pesquisa, com purpose explícito e automaticEditorialImport false; não produz corpo editorial ou altera outro subsistema. Sua saída pode conter dados privados: não enviar a logs públicos.

Códigos: 0 sucesso (inclui falha parcial com outras fontes disponíveis); 2 argumento/contrato/configuração inválidos; 3 nenhuma fonte utilizável; 4 I/O/concorrência/limite de armazenamento. Motivos de descarte/adiamento são obrigatórios. Filtros desconhecidos ou valores inválidos não são ignorados.

Dry-run executa consultas respeitando cache/cooldown e calcula plano em memória, sem gravar cache, fila, lock ou histórico. Leituras não fazem rede. Uma simulação pode consumir o intervalo externo de um provedor sem persistir cooldown: respeite os intervalos e não use repetições do dry-run para contornar limites. Não há push/deploy pelo comando.

## Homologação e futura integração

Fixtures XML são claramente sintéticas e testes usam servidor HTTP local, sem internet no CI. O transporte é substituído apenas na fronteira de teste; destino/host/DNS/redirect continuam sendo validados pelas mesmas funções. Nenhuma flag ou configuração de produção habilita localhost, HTTP ou modo inseguro. Os testes anteriores continuam no npm test e o workflow instala o lockfile antes dos testes; não executa coleta real nem cria agendamento.

O futuro motor de pesquisa deve consumir export, abrir referências por fluxo próprio seguro/autorizado, verificar fatos/datas/independência/contexto e obter imagem/direitos. Só depois deverá montar o envelope editorial 1.0 com fontes consultadas, evidências por parágrafo e autorização real, submetendo import/validate e revisão explícita. Sinais de popularidade não são evidência factual. IA futura não pode preencher aprovações, licenças ou afirmações fictícias, nem escrever diretamente em content/public. Nenhuma integração de pesquisa ou IA foi realizada nesta entrega.
