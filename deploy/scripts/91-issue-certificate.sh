#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_command certbot
require_command openssl

email=${1:-}
credentials=${2:-/etc/letsencrypt/cloudflare-pulsobit.ini}
[[ ${email} == *@*.* ]] || die "uso: $0 EMAIL [ARQUIVO_CREDENCIAL_CLOUDFLARE]"
[[ -f ${credentials} ]] || die "arquivo de credencial DNS-01 ausente: ${credentials}."
[[ $(stat -c '%a' "${credentials}") =~ ^(400|600)$ ]] ||
  die "credencial Cloudflare deve ter permissão 0400 ou 0600."
certbot plugins --text 2>/dev/null | grep -q 'dns-cloudflare' ||
  die "plugin Certbot dns-cloudflare não instalado; instale-o em etapa administrativa separada."

certificate="/etc/letsencrypt/live/pulsobit.tech/fullchain.pem"
if [[ -f ${certificate} ]] && openssl x509 -checkend 604800 -noout -in "${certificate}" >/dev/null; then
  log "certificado existente ainda é válido por mais de sete dias"
else
  certbot certonly \
    --cert-name pulsobit.tech \
    --dns-cloudflare \
    --dns-cloudflare-credentials "${credentials}" \
    --email "${email}" \
    --agree-tos \
    --non-interactive \
    -d pulsobit.tech \
    -d www.pulsobit.tech
fi

openssl x509 -noout -subject -issuer -dates -ext subjectAltName -in "${certificate}"
log "certificado obtido; modo SSL/TLS do Cloudflare não foi alterado"
