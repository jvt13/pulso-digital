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
[[ ${PULSO_DATA_ROOT:-} == "${STATE_ROOT}" ]] || die "PULSO_DATA_ROOT deve ser ${STATE_ROOT}."

snapshot_id=${1:-${PULSO_CHECKPOINT_ID:-}}
[[ ${snapshot_id} =~ ^[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}$ ]] ||
  die "informe o snapshot ID como argumento ou PULSO_CHECKPOINT_ID."

import_root=${2:-${STATE_ROOT}/import/pd0072}
assert_under "${import_root}" "${STATE_ROOT}/import"
root=$(repo_root)

if [[ -f "${STATE_ROOT}/storage/data/operational.sqlcipher" || -f "${STATE_ROOT}/storage/data/operational.json" ]]; then
  log "backend ativo já existe; será validado sem sobrescrita"
  [[ -d "${STATE_ROOT}/storage/data/snapshots/${snapshot_id}" ]] ||
    die "checkpoint ${snapshot_id} não está no estado ativo."
  run_storage "${root}" verify
  runuser -u "${SERVICE_USER}" -- env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${STATE_ROOT}" \
    "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"
  runuser -u "${SERVICE_USER}" -- env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${STATE_ROOT}" \
    "${NODE_BIN}" "${root}/tools/verify-safe-state.mjs" "${root}"
  exit 0
fi

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  die "serviço ${SERVICE_NAME} está ativo; operação cancelada."
fi

"${SCRIPT_DIR}/60-verify-storage-import.sh" "${snapshot_id}" "${import_root}"

activation="${STATE_ROOT}/.activate-${snapshot_id}"
assert_under "${activation}" "${STATE_ROOT}"
[[ ! -e ${activation} ]] || die "diretório de ativação anterior existe: ${activation}."
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 \
  "${activation}/storage/data/snapshots"
cp -a "${import_root}/storage/data/operational.sqlcipher" "${activation}/storage/data/"
cp -a "${import_root}/storage/data/operational.json" "${activation}/storage/data/"
if [[ -f "${import_root}/storage/data/operational-migration.json" ]]; then
  cp -a "${import_root}/storage/data/operational-migration.json" "${activation}/storage/data/"
fi
cp -a "${import_root}/storage/data/snapshots/${snapshot_id}" \
  "${activation}/storage/data/snapshots/"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${activation}"
chmod 0700 "${activation}/storage/data"
chmod 0600 "${activation}/storage/data/operational.sqlcipher" \
  "${activation}/storage/data/operational.json"

runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${activation}" \
  "${NODE_BIN}" "${root}/src/storage/cli.mjs" verify
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${activation}" \
  "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"

active_data="${STATE_ROOT}/storage/data"
if [[ -d ${active_data} ]] && [[ -n $(find "${active_data}" -mindepth 1 -print -quit) ]]; then
  die "diretório ativo não está vazio; ativação cancelada."
fi
rmdir "${active_data}"
mv -- "${activation}/storage/data" "${STATE_ROOT}/storage/data"
rmdir -- "${activation}/storage" "${activation}"

run_storage "${root}" verify
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${STATE_ROOT}" \
  "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${STATE_ROOT}" \
  "${NODE_BIN}" "${root}/tools/verify-safe-state.mjs" "${root}"
log "backend operacional importado e validado; import original preservado em ${import_root}"
