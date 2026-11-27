# Implantação isolada na VPS

Este runbook prepara a futura implantação do PulsoBit em Linux. Nenhum comando deste
documento foi executado na VPS durante a PD-007.1. Os exemplos são genéricos e não
registram IP, credenciais ou nomes de aplicações de outros projetos.

## Pré-requisitos a confirmar

- Ubuntu 24.04 LTS, arquitetura `x86_64`.
- Pelo menos 1 vCPU, 2 GiB de RAM e espaço livre dimensionado para releases, banco,
  snapshots e backups externos.
- Acesso administrativo por SSH e janela de manutenção autorizada.
- Nginx e Certbot disponíveis. A versão efetiva deve ser registrada antes da ativação.
- DNS de `pulsobit.tech` e `www.pulsobit.tech` já publicado, sem alterações nesta tarefa.
- Domínio principal servido pela VPS; GitHub Pages continua sendo apenas homologação.

## Layout persistente

```text
/opt/pulso-digital/
  releases/<versao>-<commit>/
  current -> releases/<versao>-<commit>/
  runtime/node-v24.22.3-linux-x64/
  venv/

/var/lib/pulso-digital/
  storage/data/
  radar/data/
  newsroom/data/
  editorial/data/
  backups/

/etc/pulso-digital/
  pulso.env

/var/www/pulso-digital/
  conteúdo estritamente público
```

`PULSO_DATA_ROOT=/var/lib/pulso-digital` mantém banco, caches, imagens privadas,
journals, locks e snapshots fora da release. Sem essa variável, o projeto conserva o
comportamento local anterior, usando os diretórios dentro da própria raiz.

`PULSO_STORAGE_KEY` e `PULSO_PYTHON_BIN` ficam em `/etc/pulso-digital/pulso.env`, com
leitura restrita ao usuário de serviço. A chave nunca deve ser copiada para a release,
GitHub, relatórios públicos ou backup não cifrado.

## Node.js 24 LTS isolado

A documentação oficial `https://nodejs.org/en/about/previous-releases` e o índice
oficial `https://nodejs.org/dist/index.json` foram consultados em 2026-11-26. A versão
LTS disponível era `v24.22.3` (Krypton), com npm `11.19.1`.

```bash
NODE_VERSION=24.22.3
NODE_SHA256=4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb
cd /opt/pulso-digital/runtime
curl -fLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
echo "${NODE_SHA256}  node-v${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c -
tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz"
/opt/pulso-digital/runtime/node-v${NODE_VERSION}-linux-x64/bin/node --version
```

Não substitua o Node.js global usado por outras aplicações. O systemd aponta para o
executável absoluto dessa instalação independente.

## Dependências e SQLCipher

Instale ferramentas de compilação no sistema operacional e preserve a versão exata do
lockfile:

```bash
cd /opt/pulso-digital/current
/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin/npm ci
/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin/npm rebuild better-sqlite3-multiple-ciphers
/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin/node -e "import('better-sqlite3-multiple-ciphers').then(() => console.log('sqlite-native-ok'))"
```

O módulo nativo deve corresponder a `linux-x64` e ao ABI do Node 24. Uma release sem
esse teste, ou sem `npm run storage -- verify`, não deve ser ativada.

## Python e Pillow

A documentação oficial consultada foi
`https://docs.python.org/3/library/venv.html` e
`https://pillow.readthedocs.io/en/stable/installation.html` (Pillow 13.0.0, publicada
em 2026-10-16).

```bash
python3.12 -m venv /opt/pulso-digital/venv
/opt/pulso-digital/venv/bin/python -m pip install --upgrade pip
/opt/pulso-digital/venv/bin/python -m pip install -r /opt/pulso-digital/current/deploy/requirements-image.txt
/opt/pulso-digital/venv/bin/python -c "from PIL import Image; print(Image.__version__)"
```

`PULSO_PYTHON_BIN` deve apontar para esse interpretador. Não instale pacotes Python
globalmente nem altere ambientes de outros serviços.

## Preparação e ativação de release

Os builds podem ser feitos no desenvolvimento ou no CI, reduzindo carga na VPS:

```bash
npm ci
npm run build:homologation
npm run build:production
npm run verify:homologation
npm run verify:production
npm test
```

Para preparar uma release:

1. Crie `/opt/pulso-digital/releases/<versao>-<commit>`.
2. Extraia ou copie o código versionado e execute `npm ci`.
3. Copie para a nova release o estado editorial mutável que ainda permanece dentro do
   projeto (`content/` e `public/`) da release ativa, antes de qualquer build.
4. Gere ou copie `dist/production`.
5. Valide hashes, contagem de páginas e ausência de arquivos privados.
6. Só então altere o symlink `current` de forma atômica.
7. Sincronize `current/dist/production` para `/var/www/pulso-digital` com um diretório
   temporário e `rename`, evitando mistura de versões.
8. Execute `nginx -t` antes de qualquer reload do Nginx.

O banco, a chave, os hashes editoriais, os journals e a configuração privada nunca são
substituídos por uma nova release.

## Systemd

O exemplo está em `deploy/systemd/pulso-digital.service.example`. Ele usa:

- usuário dedicado `pulso-digital`;
- Node.js 24 absoluto;
- `PULSO_DATA_ROOT` externo;
- journal para logs;
- `MemoryMax=512M`, `CPUWeight=50`, encerramento por `SIGTERM`;
- `ProtectSystem=strict` e permissões de escrita apenas nos diretórios necessários.

O limite de memória e CPU é inicial e precisa ser homologado. A unidade não deve ser
instalada habilitada durante a primeira implantação: a automação permanece pausada e a
IA real desativada até autorização explícita do operador.

## Nginx e HTTPS

Use o exemplo `deploy/nginx/pulsobit.tech.conf.example`. Ele:

- serve somente `/var/www/pulso-digital`;
- redireciona `www` para o domínio principal;
- bloqueia dotfiles, bancos, logs e extensões privadas;
- não aplica cache longo a HTML, RSS ou sitemap;
- separa cache de assets;
- inclui cabeçalhos básicos de segurança.

O procedimento homologado usa HTTP-01 com webroot `/var/www/letsencrypt`, preservado no
vhost HTTP. DNS-01 permanece como alternativa para uma tarefa futuramente autorizada,
com credencial Cloudflare restrita e armazenada fora do repositório. A condição final é
Cloudflare `Full (strict)` com certificado válido também na origem; `Flexible` não é
aceitável como solução definitiva.

Validação futura:

```bash
nginx -t
systemctl reload nginx
curl -I http://pulsobit.tech/
curl -I https://pulsobit.tech/
curl -I https://www.pulsobit.tech/
curl -fsS https://pulsobit.tech/robots.txt
curl -fsS https://pulsobit.tech/rss.xml | head
```

O reload só deve ocorrer após `nginx -t` bem-sucedido e revisão das demais
configurações existentes.

## Indexação de pré-lançamento

Os dois ambientes são gerados com `indexing=false`. Produção publica `noindex,follow` e
`robots.txt` com `Disallow: /`. Isso não protege conteúdo privado; a proteção é a
separação física entre `/var/lib/pulso-digital` e `/var/www/pulso-digital`.

Depois da homologação humana, a ativação da indexação exige:

1. Alterar somente `site/environments.json` de produção para `"indexing": true`.
2. Reconstruir e verificar o artefato.
3. Confirmar sitemap, RSS, canonical e domínio oficial.
4. Publicar a release e validar o portal real.

## Rollback

Um rollback não altera automaticamente o banco ou a chave. O procedimento preferido é:

1. Colocar a automação em pausa.
2. Registrar versão, commit, hashes e motivo.
3. Reapontar `current` para a release anterior íntegra.
4. Restaurar `/var/www/pulso-digital` a partir daquela release.
5. Executar `nginx -t`; só então recarregar o Nginx.
6. Verificar banco, marcador, journal, automação pausada e portal.

Uma migration de banco só deve ser revertida pelo mecanismo de checkpoint/restauração
homologado. Código antigo não autoriza reescrever o banco aberto.

## Segurança da VPS

O plano de firewall deve ser elaborado separadamente porque a máquina hospeda outros
serviços. Registre em documento privado, fora do repositório, as portas realmente
necessárias e os endpoints administrativos. O exemplo público limita-se a 22, 80 e 443
como conceito e mantém aplicações internas em loopback.

Não habilite firewall, não feche portas e não altere SSH nesta etapa. Antes de qualquer
mudança global:

- preserve regras que mantêm os serviços existentes acessíveis;
- teste IPv4 e IPv6;
- mantenha uma sessão SSH de recuperação;
- limite acesso direto à origem quando isso não afetar outros projetos;
- não trate Cloudflare como substituto do firewall;
- proteja o futuro painel administrativo com autenticação e rede restrita.

## Informações ainda necessárias do operador

- Janela autorizada para a primeira implantação.
- Método de autenticação administrativa que será usado na VPS.
- E-mail e conta DNS-01 autorizados para o certificado.
- Responsável editorial, contato público e dados institucionais exigidos.
- Confirmação do limite de memória/CPU após teste de carga.
- Destino de backup externo e política de retenção de snapshots.
