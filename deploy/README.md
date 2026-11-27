# Implantação manual do PulsoBit

Os scripts desta pasta são etapas independentes para Ubuntu 24.04 LTS `x86_64`.
Eles não devem ser executados em sequência automática por um único instalador.
O operador deve revisar a saída de cada etapa e interromper diante de qualquer
divergência.

## Scripts

| Script | Finalidade | Altera o host? |
| --- | --- | --- |
| `00-audit-vps.sh` | Inventário não destrutivo de SO, recursos, portas, PM2, Nginx, runtimes, certificados e firewall | não |
| `10-prepare-host.sh` | Cria usuário, grupo e diretórios dedicados | sim |
| `20-install-node.sh` | Instala Node.js 24.22.3 isolado e verifica SHA-256 | sim |
| `30-install-dependencies.sh` | Executa `npm ci`, valida o módulo SQLite e não altera Node global | somente no release |
| `40-install-python.sh` | Cria virtualenv e instala Pillow 13.0.0 | somente no diretório dedicado |
| `50-prepare-state.sh` | Prepara estado persistente e arquivo de ambiente sem criar segredos | sim |
| `55-verify-platform.sh` | Valida runtime, SQLCipher, contagens e estado seguro | não |
| `60-verify-storage-import.sh` | Verifica bundle operacional em diretório isolado | somente permissões do import |
| `61-activate-storage-import.sh` | Ativa o primeiro backend operacional após validação | sim |
| `70-build-public.sh` | Gera e valida produção; publica somente com `--activate` | opcional |
| `80-install-systemd.sh` | Instala e valida unidade, sem habilitar ou iniciar | sim |
| `90-install-nginx-bootstrap.sh` | Cria vhost exclusivo temporário que retorna 503 sem TLS | sim |
| `91-issue-certificate.sh` | Emite ou valida certificado via DNS-01 Cloudflare | certificado |
| `92-enable-nginx-tls.sh` | Ativa vhost TLS após `nginx -t` | sim |
| `95-homologate-vps.sh` | Homologação somente leitura | não |
| `96-switch-release.sh` | Troca release e público preservando banco | sim, exige `--confirm` |
| `97-rollback-release.sh` | Retorna código/público a release anterior | sim, exige `--confirm` |

## Garantias

- Caminhos absolutos são fixos e validados.
- Não há comandos `ssh`, `scp`, `sudo`, upgrade global de Node, PM2 ou PostgreSQL.
- Node/npm são chamados por caminhos absolutos.
- O serviço systemd é instalado desabilitado e não é iniciado.
- Nginx usa somente `/var/www/pulso-digital`.
- A atualização e o rollback recusam execução se a automação não estiver pausada.
- Banco e chave nunca entram nos artefatos destinados ao GitHub.
