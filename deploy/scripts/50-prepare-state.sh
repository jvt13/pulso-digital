#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 \
  "${STATE_ROOT}" \
  "${STATE_ROOT}/storage" \
  "${STATE_ROOT}/storage/data" \
  "${STATE_ROOT}/storage/data/snapshots" \
  "${STATE_ROOT}/backups" \
  "${STATE_ROOT}/import"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${CONFIG_ROOT}"

example="${CONFIG_ROOT}/pulso.env.example"
if [[ ! -f ${example} ]]; then
  install -o root -g "${SERVICE_GROUP}" -m 0640 \
    "$(repo_root)/deploy/env/pulso.env.example" "${example}"
fi

if [[ ! -f ${ENV_FILE} ]]; then
  log "crie ${ENV_FILE} a partir de ${example} e preencha as chaves fora do Git"
  log "permissão obrigatória: 0400, 0440, 0600 ou 0640"
  exit 0
fi

[[ $(stat -c '%a' "${ENV_FILE}") =~ ^(400|440|600|640)$ ]] ||
  die "${ENV_FILE} possui permissão excessiva."
log "diretórios persistentes e arquivo de ambiente protegido validados"
