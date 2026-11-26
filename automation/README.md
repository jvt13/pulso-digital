# Automação editorial — contrato 1.0

O orquestrador usa o SQLite operacional ativo (`storage/data/operational.sqlcipher`) e os
motores existentes de radar, newsroom e editorial. A automação inicia pausada e não publica,
aprova ou executa chamadas reais de IA por padrão.

## Comandos

```bash
npm run automation -- help
npm run automation -- status
npm run automation -- init
npm run automation -- plan
npm run automation -- run --once --dry-run
npm run automation -- pause --reason "Manutenção"
npm run automation -- resume
npm run automation -- jobs
npm run automation -- history
npm run automation -- health
npm run automation -- metrics --json
```

`start` é uma execução contínua em primeiro plano, compatível com systemd, e não é iniciada
permanentemente na homologação. `run --once` obedece à pausa persistente. O modo dry-run não
grava estado nem executa chamadas externas.

## Agendas padrão

- health: 5 minutos;
- radar: 30 minutos;
- seleção editorial: 120 minutos;
- backup: 24 horas.

Os horários são persistidos em UTC. A apresentação pode usar `America/Cuiaba`. Execuções
atrasadas são consolidadas com a política `coalesce`: no máximo uma execução por atividade por
ciclo, sem disparar todos os horários perdidos.

## Segurança

- Sem marcador operacional válido, o orquestrador bloqueia escritas e não retorna aos JSON
  legados.
- O lease `automation-orchestrator` impede duas instâncias concorrentes.
- A reserva e o consumo continuam no mecanismo do newsroom; o orquestrador não os reinicia.
- Chamadas de IA só ocorrem com `ai.enabled=true`, confirmação explícita da modalidade
  gratuita e provider autorizado. A configuração padrão deixa a IA desativada.
- Imagem pendente mantém o rascunho privado bloqueado para publicação.
- Backups usam o coletor consistente do banco operacional e incluem o estado da automação.
- `npm run storage -- upgrade` aplica migrations ao banco operacional ativo, com checkpoints
  pré e pós-upgrade. O hash do banco no marcador é uma linha de base; alterações legítimas
  são verificadas por SQLCipher, integridade e hashes de estado, não por imutabilidade do
  arquivo.

Documentação operacional completa: [README.md](../README.md) e
[storage/README.md](../storage/README.md).
