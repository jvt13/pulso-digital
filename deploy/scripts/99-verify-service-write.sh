#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user
require_command runuser

release=$(current_release)
probe=".service-write-test-$$"
paths=(
  "${STATE_ROOT}"
  "${release}/content"
  "${release}/public"
  "${release}/public/assets"
  "${WEB_ROOT}"
)

cleanup() {
  local path
  for path in "$@"; do
    rm -f -- "${path}/${probe}" "${path}/${probe}.renamed"
  done
}
trap 'cleanup "${paths[@]}"' EXIT

for path in "${paths[@]}"; do
  [[ -d ${path} && ! -L ${path} ]] || die "diretório ausente ou inseguro: ${path}."
  mode=$(stat -c '%a' "${path}")
  [[ ${mode} != "777" ]] || die "permissão 777 proibida: ${path}."
  runuser -u "${SERVICE_USER}" -- test -w "${path}" ||
    die "${SERVICE_USER} não possui escrita Unix em ${path}."
  runuser -u "${SERVICE_USER}" -- sh -c \
    'umask 007; printf "write-probe\n" > "$1/$2"; mv "$1/$2" "$1/$2.renamed"' \
    sh "${path}" "${probe}"
  [[ -f "${path}/${probe}.renamed" ]] ||
    die "teste atômico não produziu arquivo em ${path}."
done

"${NODE_BIN}" --version >/dev/null
log "geração e publicação atômicas validadas com ${SERVICE_USER}, sem elevar privilégios nem usar 777"
