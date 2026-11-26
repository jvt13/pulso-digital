# Newsroom privado — contrato 1.0

O newsroom recebe **pautas** 1.1 do radar, pesquisa páginas permitidas e produz **rascunhos privados** para o motor editorial 1.0. Não aprova, publica, altera `content/` ou `public/`, nem executa Git ou deploy. Uma pauta ou trecho de fonte não comprova fato. O build do portal não lê `newsroom/data/`.

## Módulos e dados

`selector` escolhe até três pautas, priorizando `queued`, acontecimentos específicos, atualidade, editorias e organizações distintas. Descartes manuais, temas amplos, pautas antigas e importações concluídas são excluídos. `research` consulta URLs originais e adicionais explícitas; `extractor` usa parse5 e `evidence-quality` para selecionar trechos por papel editorial, completude e relevância; `evidence` é o dossiê em `newsroom/data/state.json`. `writer` chama um provedor REST configurado; `budget` reserva tokens persistidos antes da chamada; `verifier` confere IDs, parágrafos, natureza factual, números, título/resumo e sintaxe; `quality` calcula o score determinístico auxiliar; `images` valida manifestos/variantes locais; `engine` mantém checkpoints e importa/revisa pelo motor editorial. O snapshot privado único é escrito em temporário + fsync + rename, sob lock exclusivo. Interrupção durante IA conserva a reserva como consumo desconhecido. Um lock só é recuperado explicitamente se o processo proprietário no mesmo host não estiver ativo.

Estados: `research-insufficient`, `ready-to-write`, `draft-generated`, `review-required`, `image-pending`, `ready-to-import`, `imported`, `failed`. Não substituem `pending/draft/validated/approved/published/rejected` do motor editorial. `imported` corresponde somente ao estado editorial **draft**. A ausência de imagem autorizada mantém `image-pending`; o contrato editorial permite importação privada sem imagem, mas sua validação para publicação a bloqueará. Mock é sempre marcado sintético e nunca pode ser importado como notícia real.

O dossiê guarda pauta, título central **não verificado**, fonte, URL original/final, organização, data informada (se houver), instante real da consulta, HTTP, tipo, limitações, hash do conteúdo e trechos de até 600 caracteres com IDs/hash, papéis editoriais e indicação de completude. `confirmed` inicia vazio; trechos de fornecedor são `attributed`, não confirmação independente. Conflitos e contexto brasileiro pendentes vão para revisão. Não são armazenados textos integrais de terceiros.

## Pesquisa e segurança

Sem API de busca gratuita adequada confirmada para esta tarefa, a pesquisa usa URLs do radar e `research ID --url URL` informado pelo operador. Hosts devem constar de `research.allowedHosts` após avaliação de condições. O coletor restringe HTTPS/443, sem credenciais/IP literal, revalida DNS em cada destino/redirecionamento, fixa IP público na conexão, bloqueia redes internas e metadados, e impõe timeout, tamanho de 512 KiB, dois redirecionamentos e retry limitado. Consulta `robots.txt` como texto; falha ou proibição bloqueia a fonte. Cache de trechos por 15 minutos somente quando a resposta permite; `no-store` e `no-cache` não são reutilizados. URLs sugeridas pela IA nunca são seguidas automaticamente. HTML externo é dado não confiável, sem execução de script; o modelo recebe somente o dossiê delimitado, sem chaves ou ferramentas.

## Provedores e custos

Configuração inicial: Groq `openai/gpt-oss-120b` como redator; [modelo disponível](https://console.groq.com/docs/models), [saída JSON Schema strict](https://console.groq.com/docs/structured-outputs), [limites oficiais gratuitos](https://console.groq.com/docs/rate-limits), [API](https://console.groq.com/docs/api-reference), [faturamento](https://console.groq.com/docs/billing-faqs) e [dados](https://console.groq.com/docs/your-data) consultados em 25/11/2026. A tabela oficial mostrava 30 RPM, 1.000 RPD, 8.000 TPM e 200.000 TPD para GPT-OSS 120B na modalidade gratuita; estes limites podem mudar. Gemini usa `gemini-3.5-flash-lite` como revisor independente, com [modelos](https://ai.google.dev/gemini-api/docs/models), [preços](https://ai.google.dev/gemini-api/docs/pricing), [limites](https://ai.google.dev/gemini-api/docs/rate-limits), [saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output) e [termos](https://ai.google.dev/gemini-api/terms) consultados em 25/11/2026. A faixa gratuita do Gemini pode usar dados para melhoria do produto; envie somente o texto, claims e trechos mínimos necessários. Grounding, ferramentas, URLs e fallback pago permanecem desativados. Nenhum serviço pago é habilitado.

Limites internos: `paidProvidersEnabled=false`, três pautas por execução, duas por categoria/organização, uma chamada IA simultânea, até três chamadas por pauta, 50.000 tokens/dia, entrada estimada até 4.000 incluindo 800 tokens de margem para instruções e schema, saída máxima de 3.000 **incluindo raciocínio**, teto de 7.000 tokens reservados por minuto, intervalo mínimo de 60 segundos e gasto mensal US$ 0. O cálculo de entrada usa `ceil(caracteres/3)+800`: é uma estimativa conservadora, não um tokenizador oficial; os números efetivos do provedor e os limites da organização prevalecem. A reserva é persistida antes da chamada; resposta sem consumo ou chamada incompleta conserva a reserva. Consumo confirmado substitui a reserva somente em conclusão com contagem recebida. Os cabeçalhos de limite permitidos, `Retry-After`, duração e divisão de tokens são registrados sem cabeçalhos de autenticação. Erros HTTP registram código, tipo, mensagem limitada e identificador da requisição, sem chave. HTTP 429 não dispara repetição automática: diagnostique e respeite o intervalo informado. Esses limites não substituem cotas nem controles de faturamento da conta. Sem confirmação explícita de conta gratuita (`--confirm-free-tier`) e `GROQ_API_KEY`/`GEMINI_API_KEY`, chamada real é bloqueada antes de reservar tokens. Configure a chave em variável de ambiente ou `.env` local ignorado; nunca a coloque no chat, logs ou Git. `.env.example` contém apenas nomes vazios.

## CLI

```bash
npm run newsroom -- help
npm run newsroom -- status
npm run newsroom -- providers
npm run newsroom -- plan --limit 3
npm run newsroom -- run --dry-run --json
npm run newsroom -- research pauta-ID
npm run newsroom -- research pauta-ID --url https://host-validado/exemplo
npm run newsroom -- evidence pauta-ID
npm run newsroom -- write pauta-ID --confirm-free-tier [--reason "Retomada controlada"]
npm run newsroom -- verify pauta-ID
npm run newsroom -- prepare-image pauta-ID
npm run newsroom -- import pauta-ID
npm run newsroom -- enrich pauta-ID --reason "Atualização de evidências"
npm run newsroom -- revise pauta-ID --file reports/revisao.json --reason "Revisão editorial"
npm run newsroom -- quality pauta-ID
npm run newsroom -- review pauta-ID --dry-run
npm run newsroom -- review pauta-ID --confirm-free-tier
npm run newsroom -- review-status pauta-ID
npm run newsroom -- review-history pauta-ID
npm run newsroom -- eligibility pauta-ID
npm run newsroom -- repair-classification pauta-ID --reason "Correção mecânica comprovada"
npm run newsroom -- repair-review-finding pauta-ID --finding-id ACHADO --reason "Correção mecânica"
npm run newsroom -- run --limit 3 --confirm-free-tier
npm run newsroom -- show pauta-ID
npm run newsroom -- list
npm run newsroom -- usage
```

Use o ID completo do radar. `--json` retorna dados estruturados; não envie resultados com dossiês/rascunhos para logs públicos. `run --dry-run` não consulta fontes, não chama IA, não altera orçamento/filas/histórico e não grava arquivos. `run` retoma checkpoints, respeita limites e para em pesquisa insuficiente ou revisão pendente. Códigos: 0 sucesso; 2 argumento/contrato; 3 credencial/modalidade gratuita ausente; 4 I/O/lock. Um erro de fonte não apaga pesquisas anteriores.

## Redação, verificação e imagem

O contrato persistido continua sendo `draft-v1` (`prompts/draft-v1.md` e `schemas/draft-v1.schema.json`). A redação atual usa o transporte compacto 2.0 em `prompts/draft-v2.md` e `schemas/draft-transport-v2.schema.json`: claims não repetem `text`, posições `s/p` localizam o parágrafo, evidências usam aliases `e1..eN` e o Node reconstrói texto, slug, categoria, classificação e `claimTaxonomyVersion` antes de chamar o verificador. Aliases, posições, cobertura, atribuições e rastreabilidade inválidas são rejeitadas. `reasoning_effort` da Groq é parametrizável (`low` na configuração atual) e o raciocínio continua incluído na reserva de saída.

Cada parágrafo exige exatamente um claim reconstruído com `nature`, `evidenceIds` e `attribution` explícita quando atribuído. Título e resumo exigem `titleEvidenceIds` e `summaryEvidenceIds`; números e citações sem suporte são bloqueados, e evidência truncada não pode sustentar manchete/resumo. `verifier` bloqueia IDs inventados, número não encontrado nas evidências/título da fonte, fato numérico classificado como opinião, parágrafo sem claim, HTML/JavaScript e placeholders. Verificação lexical e JSON **não comprovam equivalência semântica**, independência, verdade factual, originalidade ou licença. A revisão humana factual e dos direitos continua obrigatória no motor editorial. Respostas com divergência conhecida ou uma única organização recebem aviso.

O `Editorial Quality Score` determinístico usa pesos 30/25/15/15/15 para precisão/rastreabilidade, profundidade, clareza, título/resumo e utilidade. Ele expõe cobertura e limitações, retorna score nulo quando há falha bloqueante e não substitui revisão semântica ou aprovação.

## Revisão semântica independente

Após `storage activate`, os repositórios de radar, newsroom e editorial leem e escrevem no
`storage/data/operational.sqlcipher`; os JSON privados permanecem intactos como legado de
recuperação. Consumo, revisões, históricos e assets são migrados junto do estado do newsroom.

`review-v2` envia ao Gemini um payload compacto: título, resumo, seções, claims com aliases
de evidência e cada trecho de evidência uma única vez, preservando até 600 caracteres por
trecho. O resultado continua no contrato `review-v1`, vinculado ao hash integral e à
configuração do revisor. Aliases e IDs inexistentes, respostas truncadas e resultados
incompatíveis são rejeitados. Severidade `critical`/`major`, claims contraditos e sinais de
prompt injection elevam o resultado efetivo; falhas determinísticas bloqueantes nunca são
sobrescritas. `thinkingLevel: minimal` é explícito e limitado à faixa do modelo.

O orçamento de revisão é separado por provedor/operação: nesta homologação, até 2 chamadas por tarefa, 15.000 tokens, 4.000 de entrada estimada, 3.000 de saída e 7.000 tokens por minuto. A pré-checagem da redação reserva margem para a revisão posterior. A chamada real usou `gemini-3.5-flash-lite`; a configuração inicial com 3.8 Flash excedeu timeout e foi descartada.

Para imagem, manifestos oficiais/licenciados preparados pelo operador continuam sendo a
entrada preferencial. Quando não existe manifesto, `prepare-image` gera uma ilustração
própria determinística com software local, identifica-a como ilustração e registra origem,
crédito, licença, fundamento, alt, legenda, hash, dimensões e variantes WebP/JPEG. Também
aceita um `original.jpg/png/webp` local com pelo menos 1600×900 e proporção 16:9, gerando as
três variantes com Pillow local. A ferramenta nunca baixa imagem sem fundamento, não amplia
bitmap pequeno e não presume autorização pela disponibilidade pública. Direitos no manifesto
não equivalem a aprovação editorial: revisão humana e aprovação explícita continuam
obrigatórias.

`eligibility` combina validação determinística, revisão semântica vinculada ao hash atual,
evidências, manifesto de imagem, importação, validação editorial, aprovação humana, integridade
e journal. `repair-classification` e `repair-review-finding` aplicam somente correções
mecânicas estreitas baseadas em evidência e registram hashes anterior/posterior; não redigem
conteúdo e não aprovam.

## Exemplo operacional e recuperação

1. `plan --limit 3` mostra seleção/motivos. Confirme manualmente atualidade e interesse.
2. `research ID` consulta referências permitidas; `evidence ID` permite ler fontes, URLs, trechos e lacunas.
3. Após confirmar modalidade gratuita da conta e configurar chave local: `write ID --confirm-free-tier`; `verify ID` registra falhas/avisos. A IA não pode inventar evidência válida: IDs são comparados ao dossiê. Se for insuficiente, pare para pesquisa humana.
4. Prepare manifesto/arquivos de imagem próprios ou autorizados, execute `prepare-image ID`, então `import ID`. Se não houver imagem, o rascunho privado pode ser importado com `image-pending` e **não passa na validação para publicação**. O arquivo incoming e registro editorial são persistidos privadamente. Repetir import com mesmo envelope retorna o ID existente; divergência exige revisão controlada, sem sobrescrita.
5. Em falha entre gravação de incoming e importação, repita `import ID`; bytes iguais são reutilizados. Se o registro editorial já existir, o hash do envelope é conferido antes de marcar `imported`. O snapshot do newsroom e o registro editorial pertencem a duas áreas com locks próprios, sem promessa de transação atômica entre elas. Um lock órfão comprovado pode ser removido por `recover --reason "..."`; nunca remova lock ativo. Backups operacionais dependem do operador.

Testes sintéticos usam servidor HTTP local injetado somente na fronteira de transporte e mock determinístico. CI não acessa IA nem fontes reais. O orquestrador 1.4.7 reutiliza este fluxo e entrega somente drafts privados ao fluxo de validação/aprovação humana já existente.
