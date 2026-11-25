# Newsroom privado — contrato 1.0

O newsroom recebe **pautas** 1.1 do radar, pesquisa páginas permitidas e produz **rascunhos privados** para o motor editorial 1.0. Não aprova, publica, altera `content/` ou `public/`, nem executa Git ou deploy. Uma pauta ou trecho de fonte não comprova fato. O build do portal não lê `newsroom/data/`.

## Módulos e dados

`selector` escolhe até três pautas, priorizando `queued`, acontecimentos específicos, atualidade, editorias e organizações distintas. Descartes manuais, temas amplos, pautas antigas e importações concluídas são excluídos. `research` consulta URLs originais e adicionais explícitas; `extractor` usa parse5 para selecionar poucos parágrafos úteis; `evidence` é o dossiê em `newsroom/data/state.json`. `writer` chama um provedor REST configurado; `budget` reserva tokens persistidos antes da chamada; `verifier` confere IDs, parágrafos, números, citações e sintaxe; `images` valida manifestos/variantes locais; `engine` mantém checkpoints e importa apenas pelo `EditorialEngine.import`. O snapshot privado único é escrito em temporário + fsync + rename, sob lock exclusivo. Interrupção durante IA conserva a reserva como consumo desconhecido. Um lock só é recuperado explicitamente se o processo proprietário no mesmo host não estiver ativo.

Estados: `research-insufficient`, `ready-to-write`, `draft-generated`, `review-required`, `image-pending`, `ready-to-import`, `imported`, `failed`. Não substituem `pending/draft/validated/approved/published/rejected` do motor editorial. `imported` corresponde somente ao estado editorial **draft**. A ausência de imagem autorizada mantém `image-pending`; o contrato editorial permite importação privada sem imagem, mas sua validação para publicação a bloqueará. Mock é sempre marcado sintético e nunca pode ser importado como notícia real.

O dossiê guarda pauta, título central **não verificado**, fonte, URL original/final, organização, data informada (se houver), instante real da consulta, HTTP, tipo, limitações, hash do conteúdo e trechos de até 300 caracteres com IDs/hash. `confirmed` inicia vazio; trechos de fornecedor são `attributed`, não confirmação independente. Conflitos e contexto brasileiro pendentes vão para revisão. Não são armazenados textos integrais de terceiros.

## Pesquisa e segurança

Sem API de busca gratuita adequada confirmada para esta tarefa, a pesquisa usa URLs do radar e `research ID --url URL` informado pelo operador. Hosts devem constar de `research.allowedHosts` após avaliação de condições. O coletor restringe HTTPS/443, sem credenciais/IP literal, revalida DNS em cada destino/redirecionamento, fixa IP público na conexão, bloqueia redes internas e metadados, e impõe timeout, tamanho de 512 KiB, dois redirecionamentos e retry limitado. Consulta `robots.txt` como texto; falha ou proibição bloqueia a fonte. Cache de trechos por 15 minutos somente quando a resposta permite; `no-store` e `no-cache` não são reutilizados. URLs sugeridas pela IA nunca são seguidas automaticamente. HTML externo é dado não confiável, sem execução de script; o modelo recebe somente o dossiê delimitado, sem chaves ou ferramentas.

## Provedores e custos

Configuração inicial: Groq `openai/gpt-oss-120b`; [modelo disponível](https://console.groq.com/docs/models), [saída JSON Schema strict](https://console.groq.com/docs/structured-outputs), [limites oficiais gratuitos](https://console.groq.com/docs/rate-limits), [API](https://console.groq.com/docs/api-reference), [faturamento](https://console.groq.com/docs/billing-faqs) e [dados](https://console.groq.com/docs/your-data) consultados em 25/11/2026. A tabela oficial mostrava 30 RPM, 1.000 RPD, 8.000 TPM e 200.000 TPD para GPT-OSS 120B na modalidade gratuita; estes limites podem mudar. O modelo é configurável em `newsroom/config.json` e sua disponibilidade na conta depende de teste autorizado. Gemini tem adaptador para `generateContent`/JSON e [preços/condições oficiais](https://ai.google.dev/gemini-api/docs/pricing), mas `models.gemini` começa vazio, sem fallback ou pesquisa integrada. A faixa gratuita Gemini pode utilizar dados para melhoria do produto; não foi enviada pauta privada a ela. Nenhum serviço pago é habilitado.

Limites internos: `paidProvidersEnabled=false`, três pautas por execução, duas por categoria/organização, uma chamada IA simultânea, até três chamadas por pauta, 50.000 tokens/dia, entrada estimada até 8.000, saída até 3.000 e teto mensal de gasto US$ 0. A reserva usa teto de saída mais estimativa conservadora da entrada; resposta sem consumo ou chamada incompleta conserva a reserva. Consumo confirmado substitui a reserva somente em conclusão com contagem recebida. Esses limites não substituem cotas nem controles de faturamento da conta. Sem confirmação explícita de conta gratuita (`--confirm-free-tier`) e `GROQ_API_KEY`/`GEMINI_API_KEY`, chamada real é bloqueada antes de reservar tokens. Configure a chave em variável de ambiente ou `.env` local ignorado; nunca a coloque no chat, logs ou Git. `.env.example` contém apenas nomes vazios.

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
npm run newsroom -- write pauta-ID --confirm-free-tier
npm run newsroom -- verify pauta-ID
npm run newsroom -- prepare-image pauta-ID
npm run newsroom -- import pauta-ID
npm run newsroom -- run --limit 3 --confirm-free-tier
npm run newsroom -- show pauta-ID
npm run newsroom -- list
npm run newsroom -- usage
```

Use o ID completo do radar. `--json` retorna dados estruturados; não envie resultados com dossiês/rascunhos para logs públicos. `run --dry-run` não consulta fontes, não chama IA, não altera orçamento/filas/histórico e não grava arquivos. `run` retoma checkpoints, respeita limites e para em pesquisa insuficiente ou revisão pendente. Códigos: 0 sucesso; 2 argumento/contrato; 3 credencial/modalidade gratuita ausente; 4 I/O/lock. Um erro de fonte não apaga pesquisas anteriores.

## Redação, verificação e imagem

Prompt versionado em `prompts/draft-v1.md`; saída Groq estrita em `schemas/draft-v1.schema.json`. Cada parágrafo exige claim com IDs de evidência existentes. `verifier` bloqueia IDs inventados, número não encontrado nos trechos citados, citação literal não encontrada, parágrafo sem claim, HTML/JavaScript e placeholders. Verificação lexical e JSON **não comprovam equivalência semântica**, independência, verdade factual, originalidade ou licença. A revisão humana factual e dos direitos continua obrigatória no motor editorial. Respostas com divergência conhecida ou uma única organização recebem aviso.

Para imagem, o operador deve preparar `newsroom/data/images/PAUTA-ID/manifest.json` com `kind`, `credit`, `sourceUrl`, `license`, `licenseUrl`, `authorizationBasis`, `checkedAt`, `alt`, `caption`, `previewAllowed`. Pode fornecer `main.webp` 1600×900, `small.webp` 640×360 e `share.jpg` 1600×900 já otimizados. Se fornecer apenas `original.jpg/png/webp` local com pelo menos 1600×900 e proporção 16:9, `prepare-image` gera as três variantes com Pillow **local opcional** (`python`, sem dependência npm permanente) e nunca amplia o original. A ferramenta valida cabeçalhos, dimensões, tamanho, origem e fundamento documentado; não baixa nem gera imagens por IA. Atestar direitos no manifesto não equivale a aprovação editorial: essa revisão permanece com operador humano. Sem manifesto válido, a imagem fica pendente. Não reutilize imagem de outra notícia só para atender ao contrato.

## Exemplo operacional e recuperação

1. `plan --limit 3` mostra seleção/motivos. Confirme manualmente atualidade e interesse.
2. `research ID` consulta referências permitidas; `evidence ID` permite ler fontes, URLs, trechos e lacunas.
3. Após confirmar modalidade gratuita da conta e configurar chave local: `write ID --confirm-free-tier`; `verify ID` registra falhas/avisos. A IA não pode inventar evidência válida: IDs são comparados ao dossiê. Se for insuficiente, pare para pesquisa humana.
4. Prepare manifesto/arquivos de imagem próprios ou autorizados, execute `prepare-image ID`, então `import ID`. Se não houver imagem, o rascunho privado pode ser importado com `image-pending` e **não passa na validação para publicação**. O arquivo incoming e registro editorial são persistidos privadamente. Repetir import com mesmo envelope retorna o ID existente; divergência exige revisão controlada, sem sobrescrita.
5. Em falha entre gravação de incoming e importação, repita `import ID`; bytes iguais são reutilizados. Se o registro editorial já existir, o hash do envelope é conferido antes de marcar `imported`. O snapshot do newsroom e o registro editorial pertencem a duas áreas com locks próprios, sem promessa de transação atômica entre elas. Um lock órfão comprovado pode ser removido por `recover --reason "..."`; nunca remova lock ativo. Backups operacionais dependem do operador.

Testes sintéticos usam servidor HTTP local injetado somente na fronteira de transporte e mock determinístico. CI não acessa IA nem fontes reais. A futura automação de pesquisa/redação deve manter limites, verificar condições das fontes e entregar somente drafts ao fluxo de validação/aprovação humana já existente.
