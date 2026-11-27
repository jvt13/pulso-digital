#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404

release=$(repo_root)
assert_under "${release}" "${RELEASES_ROOT}"
grep -q '"name"[[:space:]]*:[[:space:]]*"pulso-digital"' "${release}/package.json" ||
  die "release não corresponde ao projeto pulso-digital."
grep -q '"version"[[:space:]]*:[[:space:]]*"1.5.2"' "${release}/package.json" ||
  die "release inicial deve permanecer na versão 1.5.2."

if [[ -L ${CURRENT_LINK} ]]; then
  current=$(realpath -e -- "${CURRENT_LINK}")
  [[ ${current} == "${release}" ]] && {
    log "release atual já é ${release}"
    exit 0
  }
  die "current já aponta para ${current}; use a etapa de atualização."
fi
[[ ! -e ${CURRENT_LINK} ]] || die "${CURRENT_LINK} existe e não é symlink."

new_link="${APP_ROOT}/.current.initial.$$"
ln -s "${release}" "${new_link}"
mv -Tf "${new_link}" "${CURRENT_LINK}"
log "release inicial vinculada em ${CURRENT_LINK}"
