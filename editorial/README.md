# Motor editorial — contrato 1.0

O motor recebe JSON manual, sem acessar a rede, e prepara conteúdo para o gerador estático existente. Importação e build não aprovam nem publicam rascunhos. Nenhum comando editorial executa Git, push, deploy, agendamento ou integração externa.

## Módulos

- `src/editorial/schema.mjs`: contrato versionado, erros, JSON canônico e SHA-256.
- `validator.mjs`: estrutura, limites, rastreabilidade declarada, segurança e imagens.
- `image.mjs`: dimensões lidas dos cabeçalhos WebP/JPEG/PNG, sem biblioteca externa.
- `deduplication.mjs`: normalização, hash do corpo, URLs e similaridade de títulos.
- `lifecycle.mjs`: transições e histórico encadeado por hash.
- `repository.mjs`: armazenamento privado, confinamento de caminhos, lock e diário recuperável.
- `publisher.mjs`: projeção pública, cópia temporária, build, integridade e aplicação recuperável.
- `engine.mjs`: operações do fluxo, separadas do armazenamento e da CLI.
- `cli.mjs`: interface em português, saída JSON e códigos de saída.

Os dois módulos adicionais (`image` e `engine`) mantêm parsing de imagens e orquestração fora dos módulos de validação/armazenamento. Não há dependências npm novas.

## Entrada e saída

O schema público está em `schemas/input-v1.schema.json` (JSON Schema 2020-12). O validador nativo implementa apenas os termos usados nesse arquivo; não é um validador genérico de qualquer JSON Schema. `schemaVersion` é `1.0`. Campos desconhecidos são rejeitados, inclusive tentativas de importar aprovação, estado ou histórico.

O envelope de entrada contém `id`, `operation` (`create`/`update`), `targetSlug` para atualização, `synthetic`, `origin` (`manual`/`json`, com referência) e `article`. Uma pauta incompleta pode conter apenas título e continuar em draft; a validação para publicação exige o restante dos campos.

`article` usa os campos existentes: `title`, `slug`, `summary`, `category`, `tags`, `sections` com títulos/parágrafos, `editorial`, `eventDate`/`eventLabel` quando relevantes e `sources`. Acrescenta `language: pt-BR`, `claims`, `image` e `changeNote` para atualização. A identificação atual é `Pulso Digital` / `Edição institucional provisória`; não são aceitos jornalistas inventados.

Cada fonte declara `id`, nome, URL HTTP/HTTPS absoluta sem credenciais e `checkedAt` em `AAAA-MM-DD`. Data original e tipo podem ser informados. A consulta não é executada pelo motor. Datas de consulta futuras ou inexistentes são bloqueadas; uma data de publicação de fonte não pode ser posterior à consulta.

Cada parágrafo deve ter uma entrada em `claims`, com `id`, índices `section`/`paragraph` iniciados em zero, `text` idêntico ao parágrafo, classificação (`confirmed`, `attributed`, `expectation`, `rumor`, `opinion`), `sourceIds` e explicação `evidence`. Expectativas e rumores precisam estar qualificados no próprio texto. Opiniões podem não ter fonte, mas precisam de justificativa. Isso testa a cobertura declarada, não a verdade nem a suficiência das evidências. Títulos, resumos e omissões também precisam ser lidos pelo revisor.

A extensão aditiva 1.1 do newsroom adiciona `claimTaxonomyVersion: "1.1"`, `nature`, `attribution`, `evidenceIds` e `article.traceability`. `documented-fact` corresponde a `confirmed`; `attributed-statement` exige `attributed` e atribuição explícita; `expectation`, `rumor` e `opinion` preservam suas classificações. Fatos numéricos não podem ser classificados como opinião sem sinal claro de interpretação. Título e resumo devem referenciar evidências já usadas pelos claims. Registros históricos sem esses campos continuam válidos; a extensão não redefine os quatro valores originais e não altera o schemaVersion 1.0.

`image` indica `key` do registro em `content/images.json`, `alt`, `caption`, `credit` e `authorization: {basis, url}`. Alt/legenda/crédito devem corresponder ao registro. Reutilização de imagem de outra matéria, inclusive sob chave diferente com mesmos bytes, exige `reuseJustification` e reconhecimento do aviso na aprovação. A justificativa é avaliada editorialmente, não certificada pelo software.

Para uma imagem nova, forneça `image.record` no formato existente de `images.json` e `image.assets: [{from, to}]`. A origem fica exclusivamente em `editorial/data/incoming/`; o destino deve começar por `assets/editorial/ID/`. Registre as três variantes, bytes e dimensões reais. O motor aceita novos assets WebP/JPEG/PNG, limita os tamanhos, confere assinatura e cabeçalho e exige imagem principal >=1200 px em 16:9. Não baixa, pesquisa, gera, redimensiona ou licencia imagens. Um registro existente não é substituído silenciosamente: use chave nova quando necessário.

O envelope interno acrescenta `recordVersion: 1.0`, `createdAt` real, `state`, resultado de validação, aprovação, recibo e histórico. Esses campos não são importáveis. Seu formato está documentado em `schemas/record-v1.schema.json`; a integridade operacional é verificada pelo código de ciclo de vida, não pelo validador simplificado do schema de entrada. Os arquivos em `editorial/data/records/` contêm material privado e devem continuar ignorados pelo Git.

A projeção pública contém somente os campos usados pelo portal e `publishedAt` real para publicações novas, `updatedAt` efetivo, nota de revisão e nota de produção institucional. IDs de fontes internos, `claims`, origem privada, caminho de entrada, operador da aprovação, resultados e histórico não são copiados para `public/` nem para as matérias públicas. O registro público de imagem recebe somente campos de proveniência/imagem permitidos.

Os oito registros atuais não são migrados ou reescritos. As alterações pequenas do gerador são: bloqueio durante operação/recuperação editorial e nota de produção opcional, preservando a saída anterior dos registros legados.

## Estados e revisão

```text
pending → draft → validated → approved → published
   └──────┴────────┴───────────→ rejected → draft
                  approved/validated → draft (revisão justificada)
```

Importar registra pending e abre draft. Rejeição exige motivo. `draft` e `revise` invalidam validação/aprovação; revisão em draft registra rejeição controlada e reabertura, preservando os snapshots anteriores. Publicado é terminal: uma revisão pública usa outro ID com `operation: update`, `targetSlug` existente e o mesmo slug. Aprovar exige estado validated, revalidação do mesmo hash, identidade explicitamente fornecida pelo operador e confirmação de revisão factual e dos direitos da imagem. Todos os avisos precisam ser reconhecidos; não existe aprovação automática.

O hash aprovado inclui entrada canônica, registro da imagem, hashes dos três assets e hash da matéria alvo, quando houver. Mudanças em texto, fontes, autorização, bytes de imagem ou alvo impedem publicação com a aprovação antiga. A publicação revalida e verifica duplicidades novamente. Avisos novos exigem nova revisão.

Cada evento registra sequência, data real, origem/destino, ação, motivo, identificação técnica ou do operador, hash anterior e snapshot. A API só acrescenta eventos; leitura valida cadeia e correspondência do estado atual ao último snapshot. Isso detecta edições parciais/silenciosas comuns. Não é assinatura digital nem proteção contra um administrador capaz de reescrever o arquivo inteiro e recalcular todos os hashes. Não há autenticação multiusuário ou âncora externa de auditoria nesta etapa.

## Validação e deduplicação

Configuração não sensível: `config.json`. Limites: JSON 256 KiB, estado/histórico 8 MiB, asset 5 MiB, preparação 50 MiB, título 180, resumo 500, parágrafo 6000 e corpo 80000 caracteres, até 30 seções/fontes, 30 parágrafos por seção e 15 tags. Entrada JSON também é limitada a 20 níveis e 10000 elementos antes da validação recursiva. Alguns tetos de memória/arquivos são limitados também no código. Slugs/IDs ASCII minúsculos, números e hífens, sem traversal, separadores, nomes reservados Windows, encoding de caminhos ou links simbólicos/junções.

Conteúdo é texto simples: HTML, JavaScript, protocolos perigosos, marcadores `TODO`/`TBD`, placeholders e campos incompletos são bloqueados. Comparações matemáticas que usem `<`/`>` devem ser reescritas em texto ou com símbolos tipográficos apropriados. O escape do gerador continua sendo aplicado; nenhum campo de entrada vira código executável.

Duplicidade exata de ID, slug colidente e corpo normalizado idêntico bloqueiam. Texto normalizado usa caixa baixa, remoção de acentos, pontuação e espaços repetidos. Títulos usam Jaccard de conjuntos de palavras com mais de um caractere, limiar configurável padrão 0,72. URLs usam parser nativo: host/porta canônicos, fragmento e parâmetros de rastreamento removidos, parâmetros restantes ordenados; o caminho mantém caixa por poder ser semanticamente relevante. Fonte em comum e título semelhante são avisos, não provas de duplicidade. Uma atualização exclui somente seu alvo publicado da comparação; outros conteúdos/rascunhos continuam sendo considerados. Rejeitados e operações já publicadas não são tratados como rascunhos concorrentes.

Quantidade de fontes não prova independência/confiabilidade. URL não prova notícia verdadeira. Similaridade baixa não prova originalidade. Cabeçalho de bitmap não substitui decodificação, inspeção visual, checagem de direitos ou análise antimalware. O responsável precisa revisar fatos, contexto e autorização explicitamente.

## Comandos

```bash
npm run editorial -- help
npm run editorial -- import editorial/data/incoming/pauta.json
npm run editorial -- list --json
npm run editorial -- show ID
npm run editorial -- validate ID --json
npm run editorial -- approve ID --reviewer IDENTIFICACAO --facts-reviewed --image-rights-reviewed --acknowledge-warnings
npm run editorial -- publish ID --dry-run --json
npm run editorial -- publish ID
npm run editorial -- history ID
npm run editorial -- reject ID --reason "Referência não sustenta a afirmação"
npm run editorial -- draft ID --reason "Retorno explícito para revisão"
npm run editorial -- revise ID editorial/data/incoming/revisao.json --reason "Correção documentada"
npm run editorial -- status --json
npm run editorial -- recover
npm run editorial -- recover --break-lock --reason "Processo anterior interrompido"
```

`--root DIRETORIO` seleciona uma cópia isolada do projeto. Caminhos de importação são relativos a essa raiz, sem depender do diretório atual. Para JSON sem o cabeçalho do npm, use `npm run --silent editorial -- status --json` ou `node src/editorial/cli.mjs status --json`. Saída JSON não deve ser enviada a logs públicos: show/history e resultados podem conter material privado. Códigos: 0 sucesso, 2 entrada/validação/comando inválido, 3 revisão/estado/aprovação, 4 duplicidade de ID/colisão, 5 escrita/build/conflito/lock/recuperação. Erros de deduplicação na validação ficam no resultado estruturado com saída 2.

### Exemplo completo seguro

1. Copie o projeto para uma pasta temporária fora da raiz real, sem copiar `editorial/data/` nem `.git/`.
2. **Somente nessa cópia**, defina `allowSyntheticPublication: true` em `editorial/config.json`. O padrão do repositório real é false e bloqueia a publicação das fixtures.
3. Na cópia, execute os comandos abaixo. A identidade `operador-simulacao` é técnica e serve exclusivamente para a simulação; as fontes `example.invalid` não foram consultadas e não representam evidência real.

```bash
npm run editorial -- import editorial/fixtures/valid-create.json
npm run editorial -- validate fixture-motor-editorial
npm run editorial -- approve fixture-motor-editorial --reviewer operador-simulacao --facts-reviewed --image-rights-reviewed --acknowledge-warnings
npm run editorial -- publish fixture-motor-editorial --dry-run
npm run editorial -- publish fixture-motor-editorial
npm run editorial -- publish fixture-motor-editorial
npm run editorial -- history fixture-motor-editorial
```

A primeira publicação acrescenta uma matéria sintética apenas na cópia. A segunda devolve o recibo anterior sem reaplicar arquivos ou acrescentar eventos. **Não faça commit/push/deploy dessa cópia.** Os testes nativos já executam e removem suas próprias cópias temporárias. `invalid-create.json` demonstra estrutura/slug/HTML inválidos; `invalid-syntax.json` demonstra erro de parser.

## Armazenamento, consistência e recuperação

Dados reais ficam exclusivamente em `editorial/data/`, ignorado pelo Git: incoming, records, lock, `transaction.json` ativo e transactions com cópias anteriores/preparadas. Backups podem conter rascunhos privados e são retidos para inspeção; não há limpeza destrutiva automática. Controle acesso e espaço localmente.

Mutações cooperativas usam mkdir exclusivo e proprietário PID/host/token. Não se remove lock de processo vivo nem de outro host. `recover --break-lock` só libera proprietário comprovadamente morto no mesmo host; um lock sem owner exige essa ação explícita e motivo. Não use a pasta como um banco distribuído entre máquinas.

A publicação cria uma raiz temporária no diretório temporário do sistema, copia apenas o gerador/configuração/assets necessários, projeta articles/images, executa o Node sem shell e valida páginas, links e JSON-LD antes de tocar nos arquivos reais. Confere novamente o fingerprint para detectar alteração externa durante a preparação.

Depois prepara backups e arquivos novos, grava um diário persistente antes da aplicação e substitui cada arquivo via temporário no mesmo diretório, fsync e rename. A matéria, o registro de imagens, assets, HTML/feed/sitemap e o estado editorial integram o mesmo plano. O ponto de confirmação é `phase: committed`, depois da última substituição, incluindo o recibo/estado publicado.

**Não há atomicidade instantânea entre múltiplos arquivos.** Em falha capturada, o diário permite rollback. Após interrupção em prepared/applying, `recover` restaura os hashes anteriores, inclusive estado aprovado; após committed, confirma o resultado já aplicado. Antes de restaurar, confere todos os hashes e backups: edição externa divergente gera conflito e não é sobrescrita. Diário inválido/corrompido fica preservado para inspeção. O build normal é bloqueado durante lock/diário pendente; outros escritores precisam cooperar. Servidores/leitores que ignoram o lock podem observar arquivos de fases diferentes durante a aplicação local. GitHub Pages só recebe o conteúdo posteriormente por um commit/deploy explícito do operador.

Garantias de fsync/rename dependem do sistema de arquivos; fsync de diretório não é suportado igualmente no Windows. Os testes cobrem exceções e interrupções simuladas nos pontos de escrita, não falha elétrica real nem administrador hostil. Recuperação é explícita e pode exigir intervenção se dados/backups forem alterados externamente. Não edite manualmente os arquivos durante uma operação.

Dry-run não cria lock, estado, evento, matéria ou asset na raiz. Usa só temporários externos, devolve validações, avisos, arquivos, conflitos e resultado esperado, e compara o fingerprint antes/depois; concorrência pode abortar a simulação. Planos não são aprovações nem reservas: publicação real faz todas as verificações de novo.

Atualizações preservam slug, publicação original e `publishedAt`. Sem mudança efetiva no material público, `updatedAt` não é renovado; mudanças apenas no motivo não tornam a notícia nova. Operação publicada é idempotente e não reaplica uma versão antiga sobre atualizações posteriores. Não há auto-commit, auto-deploy ou promoção pelo build.

## Integrações futuras

Google Trends, pesquisa e IA deverão ser **adaptadores externos**: preparar o envelope 1.0, gravá-lo em incoming e chamar import/validate. Devem fornecer fonte, consulta, classificação, evidências por parágrafo e imagem autorizada. Não devem escrever diretamente em articles/images/public nem fornecer state/history/approval. Não se usa a validação automática como aprovação factual. Mudança incompatível exige outra versão do contrato e testes de migração. Agendamentos, credenciais de fornecedor e aprovação automática continuam fora do motor entregue.

`npm test` executa testes legados e editoriais, com publicação apenas em raízes temporárias. O pipeline existente executa os mesmos testes no Linux; o desenvolvimento verifica Windows. As checagens legadas são mantidas e generalizadas apenas onde pressupunham exatamente oito registros ou SVG fixo, para que futuras publicações aprovadas não sejam recusadas por essas premissas.
