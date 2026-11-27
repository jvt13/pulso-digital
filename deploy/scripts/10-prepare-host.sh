#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404

if ! getent group "${SERVICE_GROUP}" >/dev/null; then
  groupadd --system "${SERVICE_GROUP}"
  log "grupo ${SERVICE_GROUP} criado"
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${SERVICE_GROUP}" --home-dir "${STATE_ROOT}" \
    --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
  log "usuário ${SERVICE_USER} criado"
else
  log "usuário ${SERVICE_USER} já existe"
fi

install -d -o root -g root -m 0755 "${APP_ROOT}" "${RELEASES_ROOT}" "${RUNTIME_ROOT}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${VENV_ROOT}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 \
  "${STATE_ROOT}" \
  "${STATE_ROOT}/storage" \
  "${STATE_ROOT}/storage/data" \
  "${STATE_ROOT}/storage/data/snapshots" \
  "${STATE_ROOT}/backups" \
  "${STATE_ROOT}/import"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${CONFIG_ROOT}"
install -d -o "${SERVICE_USER}" -g www-data -m 0750 "${WEB_ROOT}"

assert_not_symlink "${APP_ROOT}"
assert_not_symlink "${STATE_ROOT}"
assert_not_symlink "${CONFIG_ROOT}"
assert_not_symlink "${WEB_ROOT}"

log "usuário, grupo e diretórios dedicados preparados"
log "próximo passo: instalar o Node.js 24 independente"
