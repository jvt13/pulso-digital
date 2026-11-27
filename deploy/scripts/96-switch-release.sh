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
[[ ${confirm} == "--confirm" ]] || die "a troca exige o argumento explícito --confirm."
systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null && die "pare logicamente a automação e mantenha o serviço inativo antes da atualização."
verify_safe_state

current=$(current_release)
[[ ${target} != "${current}" ]] || die "o release informado já está ativo."
[[ -f "${target}/package.json" && -f "${target}/package-lock.json" ]] || die "release de destino incompleto."

current_version=$("${NODE_BIN}" -e 'process.stdout.write(require(process.argv[1]).version)' "${current}/package.json")
target_version=$("${NODE_BIN}" -e 'process.stdout.write(require(process.argv[1]).version)' "${target}/package.json")
"${NODE_BIN}" -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(b[i]>a[i])process.exit(0);if(b[i]<a[i])process.exit(1)}process.exit(1)' \
  "${current_version}" "${target_version}" ||
  die "a versão de destino deve ser maior que ${current_version}."

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${target}/content" "${target}/public"
cp -a "${current}/content/." "${target}/content/"
cp -a "${current}/public/." "${target}/public/"
(
  cd -- "${target}"
  run_npm ci --no-audit --no-fund
  run_npm run build:production
  run_npm run verify:production
)

new_link="${APP_ROOT}/.current.$$"
ln -s "${target}" "${new_link}"
mv -Tf "${new_link}" "${CURRENT_LINK}"
publish_public "${target}"
log "release ${target_version} ativada sem reiniciar serviço, PM2, PostgreSQL ou Nginx"
