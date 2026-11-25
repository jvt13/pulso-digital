# Armazenamento criptografado - contrato 1.0

A camada `src/storage/` produz checkpoints SQLCipher dos dados operacionais privados. Os repositórios JSON continuam sendo a fonte operacional de verdade. O banco não substitui `radar/data/`, `newsroom/data/` ou `editorial/data/`, não aprova matérias, não publica, não acessa IA e não altera `content/` ou `public/`.

## Tecnologia

- SQLCipher em modo compatível `legacy=4`, via `better-sqlite3-multiple-ciphers@13.2.0`.
- Licença MIT, Node.js ≥22, binários pré-compilados para Windows/Linux; o projeto exige Node.js ≥24.
- SQLite 3.54.1 e SQLite3 Multiple Ciphers 2.7.1.
- `journal_mode=DELETE` e `temp_store=MEMORY`, sem WAL ou arquivos temporários persistentes.
- Chave de 32 bytes em `PULSO_STORAGE_KEY`, nunca derivada de Groq ou Gemini.
- Manifesto JSON autenticado com HMAC-SHA256 derivado por HKDF; o banco é autenticado pelo próprio SQLCipher e pelo hash SHA-256 no manifesto.

A alternativa de SQLite comum com AES-256-GCM sobre o arquivo foi avaliada. Ela protegeria o snapshot persistido, mas não a página em uso durante a consulta e exigiria uma segunda camada de autenticação. Como o SQLCipher foi instalado e homologado sem dependência paga em Windows, foi escolhido. O `node:sqlite` nativo continua sem cifra transparente e não foi usado para os dados persistidos.

## Modelo

As migrations em `migrations/` criam:

- execuções, importações, snapshots e leases;
- arquivos de origem com bytes, SHA-256 e categoria;
- pautas, sinais, histórico e execuções do radar;
- cache de pesquisa, dossiês, fontes e evidências;
- rascunhos, seções, claims e histórico do newsroom;
- chamadas de IA, reservas, consumo, erros e limites;
- revisões semânticas, achados por severidade, avaliações de claims e obsolescência;
- imagens, assets privados e manifestos;
- registros e eventos editoriais;
- publicações, imagens públicas, configurações e erros operacionais.

Os contratos completos permanecem em colunas JSON canônicas. As projeções normalizadas permitem métricas e futuras consultas de painel sem uma segunda fonte de verdade.

## Comandos

```bash
npm run storage -- help
npm run storage -- status
npm run storage -- checkpoint --dry-run
npm run storage -- checkpoint
npm run storage -- verify
npm run storage -- inspect
npm run storage -- metrics --json
npm run storage -- restore --dry-run
npm run storage -- restore --target DIRETORIO
npm run storage -- keygen
npm run storage -- recover --reason "Justificativa"
```

- `checkpoint --dry-run` não cria diretório, banco ou lock.
- `restore --dry-run` autentica e lista o plano sem escrever.
- `restore --target` exige destino inexistente e monta o resultado em diretório temporário antes do rename.
- `keygen` grava a chave em `.env` sem imprimir o valor.
- Nenhum comando executa IA, aprova, publica ou faz deploy.

Códigos de saída: 0 sucesso; 2 contrato/formato; 3 chave ausente, inválida ou incorreta; 4 lock, I/O ou acesso.

## Chave e recuperação

A chave é lida primeiro do ambiente e depois de `.env`, que é ignorado pelo Git. O valor deve representar 32 bytes em base64url ou 64 caracteres hexadecimais. O manifesto guarda apenas um fingerprint SHA-256 curto e um HMAC.

- Faça backup da chave em local separado e seguro. Sem a chave original e sem backup válido, o snapshot é irrecuperável.
- Não coloque a chave em `reports/`, `public/`, Git, chat, logs ou GitHub Actions público.
- Para rotacionar, crie um novo checkpoint com a nova chave, valide a restauração e só então retire a chave anterior. O snapshot antigo continua exigindo a chave antiga.
- O comando `recover` só remove lock sem proprietário verificável ou com processo comprovadamente inativo; lock de processo vivo é preservado.

## Consistência e integridade

Antes da coleta, o storage verifica locks ativos de radar, newsroom e editorial. Cada arquivo é lido com conferência de tamanho, tipo, mtime e SHA-256. O snapshot é construído em diretório temporário, com SQLCipher desde o primeiro byte, migrations transacionais, HMAC do manifesto e rename final.

A verificação abre o banco somente em leitura, executa `integrity_check`, `foreign_key_check`, confere todos os blobs e reconstitui os indicadores. Qualquer alteração no banco, manifesto, tamanho, hash ou métrica é rejeitada.

## Estratégia de nuvem

A recomendação para a próxima etapa é separar:

- `jvt13/pulso-digital`: código público e site.
- `jvt13/pulso-digital-ops`: repositório privado para automação e snapshots.

O repositório privado deve receber `PULSO_STORAGE_KEY` em GitHub Secrets e usar permissões mínimas: `contents: write` somente nele, `actions: read` para acompanhamento e OIDC ou GitHub App/deploy key de escopo restrito para o repositório público. Não armazenar a chave no repositório público nem em logs.

Snapshots não devem ser guardados em cache do Actions como fonte primária. Para retenção, prefira release assets ou Git LFS no repositório privado, mantendo as últimas N versões e um manifesto de checksums; artefatos temporários do Actions não têm retenção permanente. Versionar cada banco no Git aumenta o histórico, então checkpoints frequentes devem ficar fora do histórico comum ou em LFS.

A execução concorrente deve usar `concurrency: group: pulso-ops-state, cancel-in-progress: false`, o lock local da CLI e, no futuro, uma lease no banco com `owner`, `host`, `token` e `expires_at`. O processo só assume a lease após conferir o vencimento e o proprietário. Checkpoint e publicação devem ser serializados. A retenção inicial sugerida é de 10 snapshots, com cópia externa periódica.

As cotas gratuitas do GitHub para Actions privados, LFS e armazenamento de releases precisam ser reconfirmadas antes da implantação; este projeto não criou repositório remoto, não configurou segredo, agendamento ou faturamento nesta tarefa.

## Limitações

- SQLCipher protege o banco em repouso; a chave precisa estar disponível no processo autorizado para consultas.
- O storage não substitui backup externo da chave e do snapshot.
- A restauração para dentro de um projeto ativo é bloqueada por padrão; ela deve ocorrer em diretório isolado e passar por revisão.
- O banco é um checkpoint consistente dos JSON, não uma replicação contínua.
- Não há painel, API REST, agendamento ou publicação autônoma nesta versão.

As revisões Gemini são projetadas na tabela `editorial_reviews`, com views `v_review_summary` e `v_review_severity`. A fonte operacional continua sendo o JSON privado do newsroom.
