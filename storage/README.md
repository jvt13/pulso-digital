# Armazenamento operacional criptografado — contrato 1.4.8

A camada `src/storage/` mantém dois artefatos distintos:

- `storage/data/operational.sqlcipher`: banco SQLCipher operacional, fonte de verdade após
  ativação explícita;
- `storage/data/snapshots/`: checkpoints imutáveis para backup, verificação e restauração
  isolada.

Os arquivos JSON de `radar/data/`, `newsroom/data/` e `editorial/data/` são preservados como
material legado de recuperação. Depois da ativação, eles não são mais lidos como fonte
operacional nem escritos pelos repositórios. `content/` e `public/` continuam separados: o
visitante do portal nunca acessa o banco.

## Tecnologia

- SQLCipher em modo compatível `legacy=4`, via `better-sqlite3-multiple-ciphers@13.2.0`.
- Licença MIT, Node.js ≥24, binários Windows/Linux.
- `journal_mode=DELETE`, `synchronous=FULL`, `temp_store=MEMORY`, `secure_delete=ON`,
  `foreign_keys=ON` e permissões de arquivo restritas.
- Chave de 32 bytes em `PULSO_STORAGE_KEY`, nunca derivada de Groq, Gemini ou de dados do
  projeto. A chave não é exibida em logs, relatórios, banco ou Git.
- Marcador assinado em `storage/data/operational.json`, com HMAC derivado por HKDF, versão do
  schema, fingerprint da fonte, hash do banco, versão da aplicação e commit.
- Manifestos de snapshot autenticados com HMAC-SHA256; o banco é autenticado pelo SQLCipher
  e pelo SHA-256 do manifesto.

SQLite comum não foi considerado criptografado por estar em diretório privado. A alternativa
de AES-256-GCM sobre snapshots foi avaliada, mas não oferece proteção transparente durante a
consulta; o SQLCipher já homologado foi reutilizado.

## Schema operacional

A migration `004_operational_store.sql` acrescenta:

- `operational_state`: JSON canônico por namespace (`radar` e `newsroom`);
- `operational_records`: registro editorial canônico individual;
- `operational_assets`: bytes, SHA-256, tipo e tópico de assets privados;
- `operational_events`: auditoria de importação, ativação e sincronização;
- views `v_operational_backend`, `v_operational_assets` e `v_operational_events`.

A migration `005_automation.sql` acrescenta as agendas, execuções, jobs, etapas, eventos e
controle da automação, com views `v_automation_status`, `v_automation_jobs`,
`v_automation_runs` e `v_automation_health`. O schema operacional ativo é v5.

As tabelas normalizadas e views anteriores continuam sendo projeções derivadas do registro
canônico por `src/storage/operational-projector.mjs`. Consultas parametrizadas, transações
`BEGIN IMMEDIATE` e hashes SHA-256 protegem leituras e escritas. Não existe uma segunda
representação editável concorrente: o JSON canônico dentro do SQLite é o registro principal e
as projeções são reconstruídas na mesma transação.

## Comandos

```bash
npm run storage -- help
npm run storage -- status
npm run storage -- migrate --dry-run
npm run storage -- migrate
npm run storage -- migration-status
npm run storage -- compare
npm run storage -- activate
npm run storage -- upgrade --dry-run
npm run storage -- upgrade
npm run storage -- verify
npm run storage -- checkpoint --dry-run
npm run storage -- checkpoint
npm run storage -- backup
npm run storage -- metrics --json
npm run storage -- retention --json
npm run storage -- inspect
npm run storage -- restore --dry-run
npm run storage -- restore --target DIRETORIO
npm run storage -- keygen
npm run storage -- recover --reason "Justificativa"
```

- `migrate --dry-run` apenas inventaria e não cria banco, snapshot ou lock.
- `migrate` cria um checkpoint pré-migração, um banco `operational.pending.*.sqlcipher` e um
  recibo assinado. A fonte de verdade continua JSON até a ativação explícita.
- `compare` confronta hashes, contagens, estados, históricos, claims, evidências, revisões,
  reservas, assets e referências. Divergência bloqueia a ativação.
- `activate` revalida a fonte, promove o banco pendente para `operational.sqlcipher`, grava o
  marcador assinado e executa o checkpoint pós-migração.
- `upgrade` aplica migrations pendentes ao banco operacional ativo, cria checkpoints pré e
  pós-upgrade e atualiza o marcador. `--dry-run` não altera o banco.
- `backup` é alias de `checkpoint`; com o backend ativo, coleta o estado consistente do
  SQLite, não os JSON legados.
- `verify`/`inspect`/`metrics` usam o banco operacional quando ativo e o snapshot mais recente
  quando não há ativação.
- `restore --target` restaura somente em diretório isolado, com destino inexistente. Uma
  reversão do backend exige exportação consistente, comparação e nova ativação; não há
  rollback destrutivo automático.

Códigos: 0 sucesso; 2 contrato/formato; 3 chave ausente/inválida/incorreta; 4 lock, I/O,
conflito, divergência ou adulteração.

## Migração e ativação

O fluxo é deliberadamente conservador:

1. inventário dos JSON, contagens, hashes, históricos, claims, evidências, revisões, reservas e
   assets;
2. checkpoint pré-migração autenticado;
3. importação para banco pendente, com projeções normalizadas;
4. comparação canônica e funcional;
5. ativação explícita, com bloqueio de escritas concorrentes e verificação de que a fonte não
   mudou;
6. checkpoint pós-migração e validação não destrutiva.

O marcador só é criado após o banco pendente ser promovido. Se a ativação falhar antes do
marcador, o backend JSON permanece efetivo. Se houver banco sem marcador, o sistema falha de
forma segura e não escolhe uma fonte de verdade por conta própria.

## Concorrência, orçamento e recuperação

Os locks de sistema de arquivos de radar, newsroom e editorial continuam protegendo operações
longas sem manter transação SQL aberta durante chamadas HTTP. O orçamento é reservado e
persistido antes da chamada externa; tentativas incompletas conservam a reserva. O banco
operacional é atualizado em transação curta e compara o hash lido antes da escrita
(`OPERATIONAL_CONFLICT`) para impedir perda silenciosa.

Uma chamada externa já enviada não é desfeita por rollback SQL. Resultados desconhecidos
permanecem conservadoramente contabilizados e exigem diagnóstico antes de nova tentativa.

## Assets e riscos residuais

Assets privados de `newsroom/data/images/` e `editorial/data/incoming/` são copiados para
`operational_assets` com bytes e SHA-256. A preparação de imagem ainda materializa arquivos
privados locais para conversão e staging; esses arquivos são cache operacional e não a fonte
de verdade. Cópias legadas em texto claro permanecem no disco e devem ser protegidas por
permissões do sistema e removidas futuramente após homologação específica.

O banco operacional não deve ser confundido com um snapshot imutável: ele é alterado durante
a operação. O hash do arquivo no marcador é uma linha de base; `storage verify` informa
`databaseHashChanged` quando o banco foi alterado legitimamente. A integridade considera
SQLCipher, `integrity_check`, `foreign_key_check`, `cipher_integrity_check`, o HMAC do marcador
e os hashes dos registros canônicos.

## Retenção e VPS

A política de retenção é simulada com limite configurável de dez snapshots; nenhuma remoção
automática é executada nesta versão. O planejador preserva o snapshot mais recente íntegro, o
backup citado no marcador operacional e snapshots com erro de integridade. `storage retention`
lista candidatos sem apagar arquivos. Snapshots protegidos por migration ou operação também
devem ser informados ao planejador. Snapshots devem
ser copiados periodicamente para destino externo à VPS, com a chave preservada separadamente.
Não use cache do GitHub Actions como armazenamento primário; artefatos temporários não têm
retenção permanente.

Implantação Linux recomendada:

- usuário de serviço dedicado, sem privilégios administrativos;
- aplicação e `public/` em diretórios de leitura controlada;
- `storage/data/` e `radar|newsroom|editorial/data/` em volume persistente com modo `0700`;
- backups em volume separado, com permissões restritas;
- `PULSO_STORAGE_KEY` e credenciais apenas em ambiente protegido ou arquivo `0600` fora do
  repositório;
- reinicialização por unidade systemd futura, sem agendamento ou exposição de portas nesta
  tarefa;
- validação pós-atualização: `storage status`, `storage verify`, `storage compare` e testes.

## Automação

O estado da automação é persistido no namespace `automation/data/state.json`, projetado nas
tabelas `automation_*` e incluído nos checkpoints e restaurações. O orquestrador usa leases
SQLite (`automation-orchestrator`) e mantém a pausa persistente. O pipeline importa somente
rascunhos privados; não há publicação automática.

## Indicadores para o painel

As projeções reutilizam `v_radar_status`, `v_editorial_pipeline`, `v_ai_usage`,
`v_review_summary`, `v_review_severity` e `v_image_inventory`, além das views operacionais.
Elas expõem pautas, dossiês, rascunhos, revisões, achados críticos, imagens pendentes, consumo
diário/mensal, erros, histórico e estado do backend sem criar API ou painel nesta tarefa.

## Limitações

- A chave precisa estar disponível para o processo autorizado; SQLCipher protege o repouso.
- Cópias legadas e arquivos materializados continuam em claro no disco até remoção futura.
- O banco é atualizado em transações curtas; não há replicação contínua nem servidor remoto.
- Não há painel, API REST, agendamento, publicação autônoma ou configuração de VPS nesta versão.
