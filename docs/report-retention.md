# Política de retenção de relatórios

## Estrutura

```text
reports/
  report.md
  project-status.md
  checkpoint.md
  cleanup-manifest.json
  evidence/
    latest/
    pending/
```

## Regras

- `report.md` contém apenas a tarefa atual.
- `project-status.md` é a visão consolidada atualizada ao final de cada tarefa.
- `checkpoint.md` descreve o andamento da tarefa atual e pode ser substituído na próxima.
- Evidências necessárias para homologação recente ficam em `evidence/latest/`.
- Evidências de aprovação, revisão ou recuperação ainda pendente ficam em
  `evidence/pending/`.
- Evidências consolidadas no Git/SQLite podem ser removidas após arquivo criptografado
  verificado.
- Logs, TAPs, capturas e artefatos reproduzíveis não devem acumular indefinidamente.
- Arquivos `unknown` não são removidos automaticamente.
- Antes de substituir `evidence/latest/`, confirme que não há pendência associada.

## Ferramenta

`npm run reports -- inventory` lista arquivos, diretórios, tamanhos e duplicidades.

`npm run reports -- plan` classifica os itens como `essential`, `pending`,
`historical-important`, `reproducible`, `duplicate`, `obsolete` ou `unknown`.

`npm run reports -- archive --archive storage/archive/reports/NOME.pulso` cria um arquivo
AES-256-GCM com a chave operacional local, fora de `reports/`, e verifica todos os hashes.

`npm run reports -- cleanup --archive storage/archive/reports/NOME.pulso --confirm` remove
somente candidatos arquivados, regulares e dentro de `reports/`. A ferramenta recusa links,
paths externos, arquivos alterados e itens não presentes no arquivo de segurança.

## Retenção

- Relatórios e evidências são privados e permanecem fora do Git.
- Snapshots operacionais nunca são removidos por esta política.
- O arquivo de segurança deve permanecer em `storage/archive/`, fora do Git e com acesso
  restrito ao operador.
- A limpeza de snapshots ou dados SQLite exige tarefa independente.
