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
load_env

root=$(repo_root)
[[ -x ${PYTHON_BIN} ]] || die "virtualenv Python ausente."
[[ $(runuser -u "${SERVICE_USER}" -- "${PYTHON_BIN}" -c 'from PIL import Image; print(Image.__version__)') == "13.0.0" ]] ||
  die "Pillow 13.0.0 não está disponível."

run_storage "${root}" verify
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
  "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"
verify_safe_state
log "runtime, SQLCipher, contagens e estado seguro validados"
