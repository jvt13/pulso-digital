#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/pulso-deploy-test.import.XXXXXX)
cleanup() {
  [[ ${TEST_ROOT} == /tmp/pulso-deploy-test.* ]] || exit 1
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

export PULSO_DEPLOY_TEST_MODE=1
export PULSO_DEPLOY_TEST_ROOT="${TEST_ROOT}"
# shellcheck source=../../deploy/scripts/lib.sh
. "${REPO_ROOT}/deploy/scripts/lib.sh"

snapshot_id="20260101T000000000Z-00000000"
active_data="${STATE_ROOT}/storage/data"
activation="${STATE_ROOT}/.activate-${snapshot_id}"
install -d "${active_data}/snapshots" "${activation}/storage/data/snapshots/${snapshot_id}"
printf 'database\n' > "${activation}/storage/data/operational.sqlcipher"
printf 'marker\n' > "${activation}/storage/data/operational.json"
printf 'manifest\n' > "${activation}/storage/data/snapshots/${snapshot_id}/manifest.json"

activate_staged_storage "${active_data}" "${activation}" "${snapshot_id}"
[[ -f "${active_data}/operational.sqlcipher" ]]
[[ -f "${active_data}/operational.json" ]]
[[ -f "${active_data}/snapshots/${snapshot_id}/manifest.json" ]]
[[ -d "${active_data}/snapshots" ]]

conflict_root="${TEST_ROOT}/conflict"
install -d "${conflict_root}/active/snapshots" "${conflict_root}/activation/storage/data/snapshots/${snapshot_id}"
printf 'existing\n' > "${conflict_root}/active/existing-private-file"
printf 'database\n' > "${conflict_root}/activation/storage/data/operational.sqlcipher"
printf 'marker\n' > "${conflict_root}/activation/storage/data/operational.json"
if (
  activate_staged_storage \
    "${conflict_root}/active" \
    "${conflict_root}/activation" \
    "${snapshot_id}"
); then
  printf 'ativação deveria ter sido recusada\n' >&2
  exit 1
fi
[[ -f "${conflict_root}/active/existing-private-file" ]]

printf 'IMPORT_ACTIVATION_SIMULATION_OK\n'
