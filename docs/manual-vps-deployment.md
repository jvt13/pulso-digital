# Implantação manual do PulsoBit na VPS

Este é o procedimento vigente para a PD-007.2. O operador executa os comandos pelo
MobaXterm em uma sessão autenticada. O agente não acessa a VPS.

## Atualização prioritária: 1.5.2 para 1.6.0

A VPS já possui a primeira instalação. Não repita preparação, migração, Node, Python,
certificado ou Nginx.

1. Clone a release 1.6.0 em `/opt/pulso-digital/releases/1.6.0`.
2. Confirme o commit publicado no relatório desta tarefa.
3. Execute primeiro o planejamento:

```bash
sudo bash /opt/pulso-digital/releases/1.6.0/deploy/scripts/96-switch-release.sh \
  --release /opt/pulso-digital/releases/1.6.0 \
  --commit COMMIT_1_6_0 \
  --dry-run
```

4. Se o plano estiver correto, execute o comando único de atualização:

```bash
sudo bash /opt/pulso-digital/releases/1.6.0/deploy/scripts/96-switch-release.sh \
  --release /opt/pulso-digital/releases/1.6.0 \
  --commit COMMIT_1_6_0 \
  --confirm
```

O comando solicita `PREPARAR`, cria checkpoint, prepara e valida a release e depois
solicita `CONFIRMAR`. Ele não atualiza Node/Python/Certbot, não altera o banco ou a
chave e não reinicia Nginx, Systemd, PM2 ou PostgreSQL.

## 1. Pré-requisitos

- Ubuntu 24.04 LTS, `x86_64`.
- Acesso administrativo por sessão SSH confiável.
- Nginx e Certbot já instalados ou instalados em etapa administrativa separada.
- Plugin `python3-certbot-dns-cloudflare` para certificado DNS-01.
- `curl`, `xz-utils`, `build-essential` e `python3.12-venv` disponíveis.
- Git e GitHub acessíveis na VPS.
- Janela de manutenção e backup externo definidos.
- Janela sem operação concorrente sobre o banco local.

Antes de instalar pacotes adicionais, revise o impacto com:

```bash
apt-get --simulate install build-essential python3.12-venv curl xz-utils certbot python3-certbot-dns-cloudflare
```

O procedimento não habilita firewall, não reinicia PM2/PostgreSQL/VPS e não altera
Node.js global.

## 2. Primeiro comando na VPS

```bash
sudo bash -c 'id; cat /etc/os-release; uname -m; free -h; df -h /; nginx -t; ss -lntup'
```

Interrompa se o SO/arquitetura divergir, se um serviço existente estiver degradado ou se
`nginx -t` falhar.

## 3. Obter a release

Use o commit publicado no relatório da PD-007.2:

```bash
sudo install -d -o root -g root -m 0755 /opt/pulso-digital/releases
sudo git clone https://github.com/jvt13/pulso-digital.git \
  /opt/pulso-digital/releases/1.5.2-pd0072
sudo git -C /opt/pulso-digital/releases/1.5.2-pd0072 checkout --detach COMMIT_PUBLICADO
```

A versão permanece 1.5.2. Não altere para 1.6.0 antes da homologação real.

## 4. Auditoria e preparação

Execute cada etapa e revise a saída:

```bash
cd /opt/pulso-digital/releases/1.5.2-pd0072
sudo bash deploy/scripts/00-audit-vps.sh
sudo bash deploy/scripts/10-prepare-host.sh
sudo bash deploy/scripts/15-link-initial-release.sh
sudo bash deploy/scripts/20-install-node.sh
sudo bash deploy/scripts/30-install-dependencies.sh
sudo bash deploy/scripts/40-install-python.sh
sudo bash deploy/scripts/50-prepare-state.sh
```

O script `20` baixa o Node `24.22.3`, confere o SHA-256 homologado e instala em
`/opt/pulso-digital/runtime/`. O script `50` não cria a chave e retorna instruções para
`/etc/pulso-digital/pulso.env`.

## 5. Configuração protegida

Crie `/etc/pulso-digital/pulso.env` com:

```text
GROQ_API_KEY=...
GEMINI_API_KEY=...
PULSO_STORAGE_KEY=...
PULSO_DATA_ROOT=/var/lib/pulso-digital
PULSO_PYTHON_BIN=/opt/pulso-digital/venv/bin/python
```

As chaves devem ser transferidas pelo cofre/gestor já usado pelo operador, nunca pelo
chat, Git, issue, log ou captura de tela. Aplique:

```bash
sudo chown root:pulso-digital /etc/pulso-digital/pulso.env
sudo chmod 0640 /etc/pulso-digital/pulso.env
```

## 6. Transferência operacional

No ambiente local, a automação deve estar pausada. Gere um checkpoint atual e o bundle:

```powershell
npm run storage -- checkpoint
node tools/create-migration-bundle.mjs SNAPSHOT_ID
```

O comando produz, fora do Git:

```text
storage/archive/pd0072-operational-SNAPSHOT_ID.tar.gz
storage/archive/pd0072-operational-SNAPSHOT_ID.tar.gz.json
```

Transfira ambos por SFTP para:

```text
/var/lib/pulso-digital/import/pd0072.tar.gz
/var/lib/pulso-digital/import/pd0072.tar.gz.json
```

As chaves não estão no bundle. Preserve os arquivos locais e não use GitHub para esse
transporte.

Na VPS:

```bash
sudo install -d -o pulso-digital -g pulso-digital -m 0750 \
  /var/lib/pulso-digital/import/pd0072
sudo tar -xzf /var/lib/pulso-digital/import/pd0072.tar.gz \
  -C /var/lib/pulso-digital/import/pd0072
cd /opt/pulso-digital/releases/1.5.2-pd0072
sudo bash deploy/scripts/55-verify-platform.sh
sudo bash deploy/scripts/60-verify-storage-import.sh SNAPSHOT_ID
sudo bash deploy/scripts/61-activate-storage-import.sh SNAPSHOT_ID
```

A etapa `60` valida banco, marcador, snapshot, hashes, integridade, schema e contagens.
A etapa `61` só ativa quando o diretório operacional está vazio, recusa sobrescrita e
preserva o import original.

## 7. Build e conteúdo público

Primeiro apenas gere e valide:

```bash
sudo bash deploy/scripts/70-build-public.sh
```

Após revisar 8 matérias, 5 editorias, 19 páginas, RSS e ausência de arquivos privados:

```bash
sudo bash deploy/scripts/70-build-public.sh --activate
```

O script guarda o público anterior em `/var/lib/pulso-digital/backups/` antes da troca.

## 8. Systemd

```bash
sudo bash deploy/scripts/80-install-systemd.sh
sudo systemctl is-enabled pulso-digital
sudo systemctl is-active pulso-digital
```

O esperado é `disabled` e `inactive`. Não execute `enable`, `start`, `restart` ou
`--confirm-free-tier` nesta tarefa.

Valide as permissões Unix efetivamente necessárias:

```bash
sudo bash deploy/scripts/99-verify-service-write.sh
```

O teste cria, renomeia e remove apenas arquivos temporários ocultos nos diretórios
operacionais dedicados. Ele não usa `777`, não executa o serviço e não concede escrita
em `/var/www` ou nos demais projetos.

## 9. Nginx e HTTPS

```bash
sudo bash deploy/scripts/90-install-nginx-bootstrap.sh
sudo bash deploy/scripts/91-issue-certificate.sh EMAIL \
  /var/www/letsencrypt
sudo bash deploy/scripts/92-enable-nginx-tls.sh
sudo bash deploy/scripts/93-install-renewal-hook.sh
```

HTTP-01 é o método padrão e usa `/var/www/letsencrypt`, preservado no vhost HTTP para as
renovações. DNS-01 permanece apenas como alternativa para uma futura tarefa autorizada;
nenhum token Cloudflare é necessário nesta implantação.

O hook de deploy executa `nginx -t`, encerra em falha real e só recarrega o Nginx após
sucesso. O script `93` executa `certbot renew --dry-run --run-deploy-hooks` para
homologar a renovação.

Confirme o reload e a mensagem do hook com:

```bash
journalctl -t pulsobit-certbot --since today --no-pager
systemctl list-timers certbot.timer --no-pager
```

Depois da validação na origem, configure somente `pulsobit.tech` como Cloudflare
`Full (strict)`. Não altere DNS nem o modo SSL/TLS de outros domínios.

## 10. Homologação

```bash
sudo bash deploy/scripts/95-homologate-vps.sh pulsobit.tech
```

O script testa origem em `127.0.0.1` com SNI do domínio e também o caminho público pelo
Cloudflare. Ele exige automação pausada, IA desativada, indexação desativada,
publicidade desativada e nenhum backend privado no web root.

Registre:

- saída de `00-audit-vps.sh` antes e depois;
- estado dos serviços PM2 existentes;
- `systemctl is-enabled/is-active pulso-digital`;
- certificado e fingerprint TLS;
- resultado de `95-homologate-vps.sh`;
- contagens e hashes do SQLite;
- consumo de CPU, memória e disco.

## 11. Atualização

Baixe a nova release em `/opt/pulso-digital/releases/` e confira o commit:

```bash
sudo git -C /opt/pulso-digital/releases/NOVA_VERSAO rev-parse HEAD
```

Primeiro execute o planejamento:

```bash
sudo bash /opt/pulso-digital/releases/NOVA_VERSAO/deploy/scripts/96-switch-release.sh \
  --release /opt/pulso-digital/releases/NOVA_VERSAO \
  --commit COMMIT_ALVO \
  --dry-run
```

Após revisar, execute o modo de aplicação:

```bash
sudo bash /opt/pulso-digital/releases/NOVA_VERSAO/deploy/scripts/96-switch-release.sh \
  --release /opt/pulso-digital/releases/NOVA_VERSAO \
  --commit COMMIT_ALVO \
  --confirm
```

O comando:

1. valida versão, commit e recursos;
2. verifica banco, contagens, automação pausada e IA desativada;
3. exige a confirmação `PREPARAR`;
4. cria checkpoint consistente;
5. preserva catálogo e assets em `content/` e `public/`;
6. reutiliza `node_modules` quando o lockfile não mudou ou executa `npm ci` com PATH isolado;
7. gera e valida produção;
8. apresenta o resumo e exige `CONFIRMAR`;
9. troca symlink e público;
10. executa verificações pós-atualização e restaura código/público automaticamente em falha.

Node.js, Python, Certbot, certificados, usuário, banco, chave, Systemd, Nginx e
configurações globais não são reinstalados ou reiniciados.

## 12. Rollback

```bash
sudo bash /opt/pulso-digital/current/deploy/scripts/97-rollback-release.sh \
  --release /opt/pulso-digital/releases/RELEASE_ANTERIOR \
  --commit COMMIT_ANTERIOR \
  --dry-run

sudo bash /opt/pulso-digital/current/deploy/scripts/97-rollback-release.sh \
  --release /opt/pulso-digital/releases/RELEASE_ANTERIOR \
  --commit COMMIT_ANTERIOR \
  --confirm
```

O rollback cria checkpoint, preserva o catálogo atual ao reconstruir a release anterior,
solicita `ROLLBACK`, troca código e público e reverte automaticamente se a verificação
falhar. Banco, marcador, snapshots, históricos e chave não são revertidos automaticamente.

## 13. Encerramento seguro

- `pulso-digital.service` permanece `inactive` e `disabled`.
- Automação permanece pausada no SQLite.
- IA real, indexação, publicidade e publicação autônoma permanecem desativadas.
- PM2, PostgreSQL, firewall e SSH não foram alterados.
- Versão 1.6.0 só será aplicada após o operador confirmar a homologação real.
