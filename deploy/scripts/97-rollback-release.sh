#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user
require_node_runtime
require_command systemctl
load_env

target=${1:-}
confirm=${2:-}
[[ -n ${target} ]] || die "uso: $0 RELEASE_DIR --confirm"
target=$(realpath -e -- "${target}")
assert_under "${target}" "${RELEASES_ROOT}"
[[ ${confirm} == "--confirm" ]] || die "o rollback exige o argumento explícito --confirm."
systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null && die "mantenha o serviço inativo durante o rollback."
verify_safe_state
[[ -f "${target}/dist/production/index.html" ]] || die "release de rollback sem artefato público."
current=$(current_release)
[[ ${target} != "${current}" ]] || {
  log "release informada já está ativa; rollback não necessário"
  exit 0
}

new_link="${APP_ROOT}/.current.rollback.$$"
ln -s "${target}" "${new_link}"
mv -Tf "${new_link}" "${CURRENT_LINK}"
publish_public "${target}"
log "rollback de código e público concluído; banco operacional e histórico não foram alterados"
