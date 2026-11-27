#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user
require_node_runtime
require_release
require_env_file
require_command systemd-analyze
require_command systemctl

root=$(repo_root)
unit_source="${root}/deploy/systemd/pulso-digital.service.example"
unit_target="/etc/systemd/system/${SERVICE_NAME}.service"
[[ -f ${unit_source} ]] || die "unidade systemd de exemplo ausente."

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  die "serviço ${SERVICE_NAME} está ativo; etapa cancelada sem reinício."
fi

if [[ -f ${unit_target} ]] && ! cmp -s "${unit_source}" "${unit_target}"; then
  backup="${STATE_ROOT}/backups/${SERVICE_NAME}.service.$(date -u +%Y%m%dT%H%M%SZ)"
  install -o root -g root -m 0644 "${unit_target}" "${backup}"
  log "unidade anterior preservada em ${backup}"
fi

install -o root -g root -m 0644 "${unit_source}" "${unit_target}"
systemd-analyze verify "${unit_target}"
systemctl daemon-reload

if systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
  die "unidade está habilitada; desabilite antes de continuar: systemctl disable ${SERVICE_NAME}"
fi

log "unidade instalada e validada; serviço permanece parado e desabilitado"
