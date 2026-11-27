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
webroot=${2:-/var/www/letsencrypt}
[[ ${email} == *@*.* ]] || die "uso: $0 EMAIL [WEBROOT]"
[[ -d ${webroot} && ! -L ${webroot} ]] || die "webroot ACME ausente ou inseguro: ${webroot}."

certificate="/etc/letsencrypt/live/pulsobit.tech/fullchain.pem"
if [[ -f ${certificate} ]] && openssl x509 -checkend 604800 -noout -in "${certificate}" >/dev/null; then
  log "certificado existente ainda é válido por mais de sete dias"
else
  certbot certonly \
    --webroot \
    --webroot-path "${webroot}" \
    --cert-name pulsobit.tech \
    --email "${email}" \
    --agree-tos \
    --non-interactive \
    -d pulsobit.tech \
    -d www.pulsobit.tech
fi

openssl x509 -noout -subject -issuer -dates -ext subjectAltName -in "${certificate}"
log "certificado validado por HTTP-01; proxy e modo SSL/TLS do Cloudflare não foram alterados"
