#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_command nginx
require_command systemctl
require_release

root=$(repo_root)
source_conf="${root}/deploy/nginx/pulsobit.tech.conf.example"
available="/etc/nginx/sites-available/pulsobit.tech.conf"
enabled="/etc/nginx/sites-enabled/pulsobit.tech.conf"
certificate="/etc/letsencrypt/live/pulsobit.tech/fullchain.pem"
private_key="/etc/letsencrypt/live/pulsobit.tech/privkey.pem"
[[ -f ${source_conf} ]] || die "configuração TLS ausente."
[[ -f ${certificate} && -f ${private_key} ]] || die "certificado TLS ainda não existe."
if [[ -L ${enabled} ]] && [[ $(readlink "${enabled}") != "../sites-available/pulsobit.tech.conf" ]]; then
  die "${enabled} aponta para outro arquivo; inspeção manual necessária."
fi
if [[ -e ${enabled} && ! -L ${enabled} ]]; then
  die "${enabled} existe e não é symlink; inspeção manual necessária."
fi

backup=""
created_link=false
previous_existed=false
if [[ -e ${available} ]]; then
  previous_existed=true
  if ! cmp -s "${source_conf}" "${available}"; then
    backup="${STATE_ROOT}/backups/nginx-pulsobit-pre-tls.$(date -u +%Y%m%dT%H%M%SZ).conf"
    install -o root -g root -m 0644 "${available}" "${backup}"
  fi
fi
install -o root -g root -m 0644 "${source_conf}" "${available}"
if [[ ! -L ${enabled} ]]; then
  ln -s ../sites-available/pulsobit.tech.conf "${enabled}"
  created_link=true
fi

if ! nginx -t; then
  if [[ -n ${backup} ]]; then
    install -o root -g root -m 0644 "${backup}" "${available}"
  elif [[ ${previous_existed} == false ]]; then
    rm -f -- "${available}"
  fi
  if [[ ${created_link} == true ]]; then
    rm -f -- "${enabled}"
  fi
  die "nginx -t falhou; configuração TLS não foi ativada."
fi

systemctl reload nginx
log "vhost TLS exclusivo ativado; nenhum outro vhost foi alterado"
