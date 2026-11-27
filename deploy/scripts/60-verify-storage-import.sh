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
load_env_values

snapshot_id=${1:-${PULSO_CHECKPOINT_ID:-}}
[[ ${snapshot_id} =~ ^[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}$ ]] ||
  die "informe o snapshot ID como argumento ou PULSO_CHECKPOINT_ID."

import_root=${2:-${STATE_ROOT}/import/pd0072}
assert_under "${import_root}" "${STATE_ROOT}/import"
[[ -f "${import_root}/storage/data/operational.sqlcipher" ]] ||
  die "banco importado ausente."
[[ -f "${import_root}/storage/data/operational.json" ]] ||
  die "marcador importado ausente."
[[ -d "${import_root}/storage/data/snapshots/${snapshot_id}" ]] ||
  die "checkpoint ${snapshot_id} ausente no import."
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${import_root}"
find "${import_root}" -type d -exec chmod 0700 {} +
find "${import_root}" -type f -exec chmod 0600 {} +

root=$(repo_root)
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${import_root}" \
  "${NODE_BIN}" "${root}/src/storage/cli.mjs" verify
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${import_root}" \
  "${NODE_BIN}" "${root}/src/storage/cli.mjs" verify --snapshot "${snapshot_id}"
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${import_root}" \
  "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"
log "import verificado no diretório isolado; nenhum estado ativo foi alterado"
