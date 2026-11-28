# Persistência operacional e migração

## Compatibilidade de caminhos

O código usa a raiz do projeto por padrão. Em produção, defina:

```text
PULSO_DATA_ROOT=/var/lib/pulso-digital
```

Com esse valor:

```text
storage/data   -> /var/lib/pulso-digital/storage/data
radar/data     -> /var/lib/pulso-digital/radar/data
newsroom/data  -> /var/lib/pulso-digital/newsroom/data
editorial/data -> /var/lib/pulso-digital/editorial/data
```

Os identificadores persistidos continuam relativos, por exemplo
`storage/data/operational.sqlcipher`. O marcador e o banco continuam vinculados por hash,
assinatura e chave. Não altere o formato ou a chave durante a troca de caminho.

## Transferência inicial segura

1. Pause a automação local e confirme que não há job, lease, lock ou chamada externa em
   andamento.
2. Gere um checkpoint cifrado consistente com `npm run storage -- checkpoint`.
3. Verifique o checkpoint e registre ID, tamanho e SHA-256.
4. Transfira banco, marcador, recibo, snapshots, assets privados e a chave por canais
   distintos e autenticados.
5. Restaure em `/var/lib/pulso-digital` mantendo permissões `0700` nos diretórios e
   `0600` nos arquivos sensíveis.
6. Execute `npm run storage -- verify` com `PULSO_DATA_ROOT` apontando ao novo local.
7. Compare contagens, hashes de estado, schema, revisões, consumo de IA, reservas,
   agendas, automação pausada e chamadas incompletas.
8. Mantenha a instância local parada após a cópia. Duas instâncias reais não podem operar
   sobre cópias divergentes do mesmo estado.

Nunca copie um SQLCipher aberto sem checkpoint consistente. Nunca use Git ou GitHub
Pages como armazenamento operacional.

## Atualização

Uma atualização substitui código, nunca o runtime ou a chave. Antes da troca:

```bash
npm run storage -- checkpoint
npm run storage -- verify
npm run automation -- status
```

A release nova recebe apenas código e dependências. Banco, marcador, journals, imagens
privadas, revisões e configurações permanecem em `/var/lib/pulso-digital` e
`/etc/pulso-digital`.

Quando o backend SQLite estiver ativo, `radar/data/state.json` e
`newsroom/data/state.json` não são pré-requisitos do checkpoint. Os estados são lidos
do banco cifrado; a coleta ignora também os registros e assets virtualizados no banco.
Os arquivos legados continuam aceitos no modo JSON, mas não precisam existir em uma
instalação cujo armazenamento migrado seja somente SQLite.

O atualizador captura uma linha de base dinâmica de schema, contagens, estados e
consumo antes da troca. A mesma referência é comparada depois da ativação. O arquivo
estático de contagens é usado apenas no procedimento inicial de migração.

O checkpoint de uma atualização a partir da 1.5.2 é criado com o código da release
1.6.0 já preparado, pois a release instalada contém o coletor legado defeituoso. Isso
não altera o banco ativo; apenas cria um snapshot consistente antes da troca.

## Rollback e recuperação

O rollback de código é feito pelo symlink de release e pela cópia atômica do artefato
público. O rollback de dados exige checkpoint íntegro, marcador compatível e autorização
do operador. Preserve sempre:

- último backup íntegro;
- backups anteriores a migrations;
- snapshots protegidos;
- journals incompletos;
- logs da falha.

Se o estado de uma chamada externa for desconhecido, não a repita automaticamente.
Marque o job para recuperação e preserve os tokens reservados.
