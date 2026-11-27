#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_release
require_command certbot
require_command logger

root=$(repo_root)
source_hook="${root}/deploy/letsencrypt/renewal-hooks/deploy/pulsobit-nginx.sh"
target_hook="/etc/letsencrypt/renewal-hooks/deploy/pulsobit-nginx.sh"
[[ -f ${source_hook} ]] || die "hook de renovação ausente no release."
install -d -o root -g root -m 0755 "$(dirname "${target_hook}")"
if [[ -f ${target_hook} ]] && ! cmp -s "${source_hook}" "${target_hook}"; then
  backup="${STATE_ROOT}/backups/pulsobit-nginx-hook.$(date -u +%Y%m%dT%H%M%SZ)"
  install -o root -g root -m 0755 "${target_hook}" "${backup}"
  log "hook anterior preservado em ${backup}"
fi
install -o root -g root -m 0755 "${source_hook}" "${target_hook}"
sh -n "${target_hook}"

certbot renew --cert-name pulsobit.tech --dry-run --run-deploy-hooks
log "hook instalado e renovação simulada aprovada; confirme o reload com journalctl"
