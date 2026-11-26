# Checklist de implantação na VPS

Este documento prepara a implantação; não configura nem acessa a VPS.

## Informações ainda necessárias do operador

- Distribuição e versão do Linux.
- Arquitetura (`x86_64` ou `arm64`) e suporte do provedor ao Node.js 24.
- RAM, CPU, disco disponível e política de crescimento.
- Bibliotecas de compilação para `better-sqlite3-multiple-ciphers`.
- Serviços e portas já utilizados.
- Domínio, DNS e certificado HTTPS.
- Reverse proxy disponível e política de firewall.
- Diretório persistente e destino externo de backup.
- Identidade, contato e horário do responsável editorial.
- Janela de manutenção e política de rollback.

## Pré-requisitos

- Linux com Node.js 24.x e npm compatível.
- Build tools para módulo SQLite nativo, se não houver binário compatível.
- Usuário de serviço sem privilégios administrativos.
- Diretórios privados para `storage/data/`, `radar/data/`, `newsroom/data/` e
  `editorial/data/`, com acesso restrito ao serviço.
- `.env` ou ambiente systemd com `PULSO_STORAGE_KEY`, Groq e Gemini, sem valores no Git.
- `public/` separado dos dados privados.
- Reverse proxy com HTTPS e somente o portal público exposto.

## Implantação progressiva

1. Publicar código na versão aprovada e instalar dependências fixadas.
2. Restaurar ou provisionar o SQLite com `PULSO_STORAGE_KEY` protegida.
3. Manter automação pausada e `ai.enabled=false`.
4. Executar `storage verify`, `storage compare` quando aplicável e `npm test`.
5. Gerar build e verificar 8 matérias, 5 editorias e 19 páginas.
6. Validar HTTPS, home, matéria, categoria, RSS, sitemap, canonical e robots.
7. Configurar monitoramento de processo, disco, integridade, erros e orçamento.
8. Homologar operação assistida sem publicação, ainda pausada.
9. Ativar `assisted` somente por decisão explícita do operador.
10. `autonomous-controlled` permanece desativado no ambiente real até tarefa futura.

## Operação

- Usuário dedicado, `NoNewPrivileges`, `ProtectSystem`, `ProtectHome` e escrita limitada aos
  diretórios persistentes.
- Timeout de parada suficiente para concluir journal e fechar conexões.
- Logs privados com rotação, retenção e permissões restritas.
- Health check periódico sem chamadas de IA.
- Alertas para lock/lease, journal pendente, jobs `recovery-required`, integridade, espaço,
  falhas sucessivas e consumo.
- Backup externo cifrado e cópia separada da chave.
- Retenção de snapshots protegidos, últimos íntegros e backups anteriores a migrations.

## Atualização e rollback

1. Pausar automação.
2. Confirmar ausência de journal, jobs e chamadas externas em andamento.
3. Gerar e verificar snapshot criptografado pré-upgrade.
4. Instalar código e dependências fixadas.
5. Aplicar migrations em cópia/checkpoint quando necessário.
6. Executar build, testes e verificação de integridade.
7. Reativar portal e automação pausada.
8. Em falha, reverter código para commit homologado e restaurar snapshot em processo
   controlado; não sobrescrever dados privados posteriores sem análise.

## Checklist de aceite da VPS

- [ ] Node.js 24 e módulo SQLCipher carregando corretamente.
- [ ] Chave armazenada fora do Git e de `public/`.
- [ ] Diretórios privados com permissão mínima.
- [ ] Portal acessível por HTTPS.
- [ ] Porta privada fechada ao público.
- [ ] `storage verify` e `automation health` aprovados.
- [ ] 8 matérias, 5 editorias, 19 páginas, RSS e sitemap.
- [ ] Ausência de dados privados em `public/`.
- [ ] Backup externo restaurado em teste isolado.
- [ ] Automação inicia pausada e IA desativada.
- [ ] Monitoramento, logs e alertas ativos.
- [ ] Plano de rollback validado.
