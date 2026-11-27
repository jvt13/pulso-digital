#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/pulso-deploy-test.XXXXXX)
cleanup() {
  [[ ${TEST_ROOT} == /tmp/pulso-deploy-test.* ]] || exit 1
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

export PULSO_DEPLOY_TEST_MODE=1
export PULSO_DEPLOY_TEST_ROOT="${TEST_ROOT}"
# shellcheck source=../../deploy/scripts/lib.sh
. "${REPO_ROOT}/deploy/scripts/lib.sh"

install -d -m 0755 "${TEST_ROOT}/var/www"
install -d -m 0755 "${RELEASES_ROOT}/r1/dist/production"
install -d -m 0770 "${RELEASES_ROOT}/r1/content"
install -d -o "$(id -u)" -g "$(id -g)" -m 0750 "${STATE_ROOT}/backups"
printf 'release-one\n' > "${RELEASES_ROOT}/r1/dist/production/index.html"
printf '{"production":true}\n' > "${RELEASES_ROOT}/r1/content/articles.json"
ln -s "${RELEASES_ROOT}/r1" "${CURRENT_LINK}"

parent_before=$(stat -c '%u:%g:%a' "${TEST_ROOT}/var/www")
publish_public "${RELEASES_ROOT}/r1"
parent_after=$(stat -c '%u:%g:%a' "${TEST_ROOT}/var/www")
[[ ${parent_before} == "${parent_after}" ]] || {
  printf 'diretório compartilhado foi alterado\n' >&2
  exit 1
}
[[ $(cat "${WEB_ROOT}/index.html") == "release-one" ]]

install -d -m 0755 "${RELEASES_ROOT}/r2/dist/production"
install -d -m 0770 "${RELEASES_ROOT}/r2/content"
printf 'release-two\n' > "${RELEASES_ROOT}/r2/dist/production/index.html"
printf '{"base":true}\n' > "${RELEASES_ROOT}/r2/content/articles.json"
cp -a "${CURRENT_LINK}/content/." "${RELEASES_ROOT}/r2/content/"
[[ $(cat "${RELEASES_ROOT}/r2/content/articles.json") == '{"production":true}' ]]
ln -s "${RELEASES_ROOT}/r2" "${APP_ROOT}/.current.update"
mv -Tf "${APP_ROOT}/.current.update" "${CURRENT_LINK}"
[[ $(readlink "${CURRENT_LINK}") == "${RELEASES_ROOT}/r2" ]]
publish_public "${RELEASES_ROOT}/r2"
old_backup=${LAST_PUBLIC_BACKUP}
[[ -n ${old_backup} && -f "${old_backup}/index.html" ]]
[[ $(cat "${WEB_ROOT}/index.html") == "release-two" ]]

restore_public_backup "${old_backup}"
ln -s "${RELEASES_ROOT}/r1" "${APP_ROOT}/.current.rollback"
mv -Tf "${APP_ROOT}/.current.rollback" "${CURRENT_LINK}"
[[ $(readlink "${CURRENT_LINK}") == "${RELEASES_ROOT}/r1" ]]
[[ $(cat "${WEB_ROOT}/index.html") == "release-one" ]]
rejected=$(find "${STATE_ROOT}/backups" -maxdepth 1 -type d -name 'public-rejected-*' -print -quit)
[[ -n ${rejected} && $(cat "${rejected}/index.html") == "release-two" ]]

printf 'PUBLISH_SIMULATION_OK\n'
