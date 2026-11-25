# Radar de pautas — contrato 1.0

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

Três feeds complementares ficam ativos: NASA News, NASA Technology e Google Blog. Não há obrigação de obter sinais de todas as editorias em toda coleta. Consultar RSS para sinais privados não autoriza republicação de textos, imagens ou marcas. O parser retém título, URL, identificador, data e metadados de pauta; descrições/corpos que venham no RSS são ignorados. Links de notícia e imagem nunca são seguidos pelo coletor.

## Rede, XML e cache

Produção aceita somente HTTPS/443, sem credenciais, IP literal ou fragmentos, em hosts exatos da fonte. Não usa proxy de ambiente, cookies ou autenticação. DNS é resolvido em cada tentativa/redirecionamento; todos os endereços retornados precisam ser públicos. A conexão fixa um endereço validado via lookup próprio, desativa reuso de agente e mantém hostname/SNI e validação TLS normais. Isso evita uma segunda resolução entre validação e conexão. Redes privadas, loopback, link-local, metadados, multicast, documentação, tradução/túneis e outras faixas especiais são recusadas conservadoramente. Consulte os registros [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) e [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/). Hosts com resposta DNS mista pública/privada são recusados.

Padrões: timeout 15 segundos por fase DNS/resposta; até 1 MiB de XML, 3 redirects, 2 conexões simultâneas, 2 retries transitórios; backoff 1/2 segundos. HTTP 429/5xx respeitam o maior entre backoff e Retry-After. Esperas de mais de 30 segundos são registradas como cooldown para futura execução; nunca reduzidas para forçar uma tentativa. Falha de fonte é isolada e registrada. Requisições pedem `Accept-Encoding: identity`; compressão inesperada é recusada em vez de aceitar bombas descomprimidas. Respostas não 200 não têm corpo baixado integralmente.

SAX é usado em modo estrito, namespaces por URI, CDATA, entidades XML predefinidas/numéricas e UTF-8 estrito. DTD, entidades customizadas/externas e processing instructions externas são proibidos. Limites padrão: profundidade 32, 40000 nós, 100 itens/feed, 1000 caracteres por campo. Entidades HTML não padronizadas em XML não são silenciosamente aceitas; devem vir em CDATA/escape válido. HTML eventual de títulos é reduzido a texto, nunca executado.

Intervalo mínimo e TTL padrão: 15 minutos. O `max-age` maior do servidor é respeitado; `no-cache` exige revalidação quando o intervalo permite; `no-store` impede guardar cache HTTP. Trends retornou no-store na homologação: permanecem as observações operacionais normalizadas, não um cache de resposta para replay. Consultas antes do intervalo são deferred quando não há cache. Não há opção force para burlar o intervalo.

O cache armazena apenas campos de sinal normalizados, ETag e Last-Modified, não o corpo bruto. HTTP 304 revalida os mesmos dados e atualiza observedAt, conservando collectedAt original. Cache fresco/stale é explicitamente identificado, preservando o instante original; replay não cria observação nova nem renova lastSeenAt. Em falha, cache de até um dia pode ser usado como stale com erro explícito. Dados além do máximo stale não são reaproveitados. Não se trata cache como coleta fresca.

## Contrato de pautas

`schemas/topic-v1.schema.json`, `schemaVersion: "1.0"`, independente do envelope editorial. Campos: id determinístico; topic/normalizedTopic; suggestedCategory ou null fora do escopo; relatedTerms; signals; sourceReferences; firstSeenAt/lastSeenAt/collectedAt; score/scoreBreakdown/priority; status; classificationReason/classificationSignals; duplicateReferences; researchQueries. History fica no registro privado e é omitido do export. O módulo contract valida invariantes operacionais, não é um validador JSON Schema genérico.

Cada sinal preserva provedor, organização, região, idioma, peso, originalId quando disponível, URL do feed, URL do item, data informada pelo feed, volume aproximado literal, termos/notícias relacionados disponibilizados, coleta real, observação e modo/cache. Não há ID original inventado: na ausência, originalId é null e uma chave técnica separada é calculada. A data do feed não comprova início da tendência nem data do acontecimento. Ausências permanecem null/lista vazia.

Estados: new (candidato ainda não selecionado), queued (seleção manual para pesquisa), deferred (adiado explicitamente), dismissed (descartado por regra ou operador com motivo). O operador pode selecionar novamente uma pauta; cada mudança fica no histórico com identidade técnica operador-local e não inventa nome de responsável. Nenhum desses estados é aprovação editorial.

## Classificação e deduplicação

Usam-se os IDs existentes: tecnologia, ia, games, espaco e tendencias. Regras configuráveis em português/inglês: palavras/frases com limites de palavra, aliases, pesos e termos negativos. Evidências de classificação registram termos encontrados, peso e contexto fraco (+1) do feed. Pelo menos uma regra textual deve existir; o feed sozinho não classifica. O mínimo é 2 pontos. Gemini/Claude/Steam/Windows/Apple isolados são fracos; termos negativos como “Claude Monet”, “apple pie” e “steam engine” impedem associações óbvias erradas.

Assunto sem contexto recebe categoria null e dismissed com justificativa, nunca Tendências como fallback. Futebol/política/celebridades não são promovidos só por popularidade. Uma conexão textual explícita com uma editoria pode ser mantida, com relevância reduzida pela metade quando coexistem termos fora do escopo. Ainda exige pesquisa humana.

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

## Armazenamento, retenção e recuperação

Tudo operacional fica em radar/data/, ignorado pelo Git: state.json, lock/owner e eventuais registros de recuperação. Cache normalizado, pautas, histórico, cooldowns e resumos de execuções integram **um único snapshot JSON**. Cada alteração é gravada em temporário no mesmo diretório, fsync e rename, sob mkdir exclusivo de lock. Falha antes do rename preserva snapshot anterior; após rename o novo snapshot inteiro é visível. Não existe transação distribuída ou escrita parcial de fila/cache/histórico separados. Leitura vê o último snapshot completo e não cria diretórios. Alteração externa durante coleta/dry-run invalida o resultado por fingerprint. Não edite arquivos enquanto uma operação estiver ativa.

Lock órfão exige `radar recover --reason ...`; só é removido se proprietário no mesmo host está comprovadamente morto, ou se ficou sem owner após interrupção. Lock ativo/de outro host não é removido. O registro de recuperação é privado. Garantias de fsync/rename dependem do sistema de arquivos; não há promessa contra falha elétrica real ou administrador hostil.

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
npm run radar -- show ID
npm run radar -- queue ID
npm run radar -- dismiss ID --reason "Sem conexão editorial demonstrável"
npm run radar -- defer ID --reason "Aguardar informação oficial"
npm run radar -- history ID
npm run radar -- status
npm run --silent radar -- export --limit 10 --json
```

`--root` seleciona outra cópia do projeto. `--json` oferece resultado estruturado; `npm run --silent` evita cabeçalho do npm. Export retorna apenas pautas para futura pesquisa, com purpose explícito e automaticEditorialImport false; não produz corpo editorial ou altera outro subsistema. Sua saída pode conter dados privados: não enviar a logs públicos.

Códigos: 0 sucesso (inclui falha parcial com outras fontes disponíveis); 2 argumento/contrato/configuração inválidos; 3 nenhuma fonte utilizável; 4 I/O/concorrência/limite de armazenamento. Motivos de descarte/adiamento são obrigatórios. Filtros desconhecidos ou valores inválidos não são ignorados.

Dry-run executa consultas respeitando cache/cooldown e calcula plano em memória, sem gravar cache, fila, lock ou histórico. Leituras não fazem rede. Uma simulação pode consumir o intervalo externo de um provedor sem persistir cooldown: respeite os intervalos e não use repetições do dry-run para contornar limites. Não há push/deploy pelo comando.

## Homologação e futura integração

Fixtures XML são claramente sintéticas e testes usam servidor HTTP local, sem internet no CI. O transporte é substituído apenas na fronteira de teste; destino/host/DNS/redirect continuam sendo validados pelas mesmas funções. Nenhuma flag ou configuração de produção habilita localhost, HTTP ou modo inseguro. Os testes anteriores continuam no npm test e o workflow instala o lockfile antes dos testes; não executa coleta real nem cria agendamento.

O futuro motor de pesquisa deve consumir export, abrir referências por fluxo próprio seguro/autorizado, verificar fatos/datas/independência/contexto e obter imagem/direitos. Só depois deverá montar o envelope editorial 1.0 com fontes consultadas, evidências por parágrafo e autorização real, submetendo import/validate e revisão explícita. Sinais de popularidade não são evidência factual. IA futura não pode preencher aprovações, licenças ou afirmações fictícias, nem escrever diretamente em content/public. Nenhuma integração de pesquisa ou IA foi realizada nesta entrega.
