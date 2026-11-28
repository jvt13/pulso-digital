#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="pulso-digital"
TEST_MODE="${PULSO_DEPLOY_TEST_MODE:-0}"
if [[ ${TEST_MODE} == "1" ]]; then
  TEST_ROOT="${PULSO_DEPLOY_TEST_ROOT:-}"
  [[ ${TEST_ROOT} =~ ^/tmp/pulso-deploy-test\.[A-Za-z0-9._-]+$ ]] ||
    { printf '[pulsobit] ERRO: PULSO_DEPLOY_TEST_ROOT inválido.\n' >&2; exit 1; }
  readonly APP_ROOT="${TEST_ROOT}/opt/pulso-digital"
  readonly STATE_ROOT="${TEST_ROOT}/var/lib/pulso-digital"
  readonly CONFIG_ROOT="${TEST_ROOT}/etc/pulso-digital"
  readonly WEB_ROOT="${TEST_ROOT}/var/www/pulso-digital"
  readonly SERVICE_USER="${PULSO_DEPLOY_TEST_USER:-$(id -un)}"
  readonly SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"
else
  readonly APP_ROOT="/opt/pulso-digital"
  readonly STATE_ROOT="/var/lib/pulso-digital"
  readonly CONFIG_ROOT="/etc/pulso-digital"
  readonly WEB_ROOT="/var/www/pulso-digital"
  readonly SERVICE_USER="pulso-digital"
  readonly SERVICE_GROUP="pulso-digital"
fi
readonly RELEASES_ROOT="${APP_ROOT}/releases"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly RUNTIME_ROOT="${APP_ROOT}/runtime"
readonly VENV_ROOT="${APP_ROOT}/venv"
readonly ENV_FILE="${CONFIG_ROOT}/pulso.env"
readonly SERVICE_NAME="pulso-digital"
readonly NODE_VERSION="24.22.3"
readonly NODE_SHA256="4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb"
readonly NODE_ROOT="${RUNTIME_ROOT}/node-v${NODE_VERSION}-linux-x64"
readonly NODE_BIN="${NODE_ROOT}/bin/node"
readonly NPM_BIN="${NODE_ROOT}/bin/npm"
readonly NPM_CLI="${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
readonly PYTHON_BIN="${VENV_ROOT}/bin/python"
LAST_PUBLIC_BACKUP=""

log() {
  printf '[pulsobit] %s\n' "$*"
}

die() {
  printf '[pulsobit] ERRO: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ ${TEST_MODE} == "1" ]] && return 0
  [[ ${EUID} -eq 0 ]] || die "execute esta etapa como root por um terminal autorizado."
}

require_ubuntu_2404() {
  [[ ${TEST_MODE} == "1" ]] && return 0
  [[ -r /etc/os-release ]] || die "não foi possível identificar o sistema operacional."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ ${ID:-} == "ubuntu" && ${VERSION_ID:-} == "24.04" ]] ||
    die "esta etapa exige Ubuntu 24.04 LTS; encontrado ${PRETTY_NAME:-desconhecido}."
  [[ $(uname -m) == "x86_64" ]] || die "arquitetura não homologada: $(uname -m)."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "comando obrigatório ausente: $1."
}

repo_root() {
  local script_dir
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  cd -- "${script_dir}/../.." && pwd
}

require_release() {
  local root package_name
  root=$(repo_root)
  [[ -f "${root}/package.json" && -f "${root}/site/environments.json" ]] ||
    die "execute o script dentro do release do PulsoBit."
  package_name=$("${NODE_BIN}" -e 'const p=require(process.argv[1]); process.stdout.write(p.name)' "${root}/package.json" 2>/dev/null || true)
  [[ ${package_name} == "pulso-digital" ]] || die "raiz do release inválida."
}

require_service_user() {
  id -u "${SERVICE_USER}" >/dev/null 2>&1 ||
    die "usuário ${SERVICE_USER} ainda não foi criado."
}

require_node_runtime() {
  [[ -x ${NODE_BIN} ]] || die "Node.js independente ausente em ${NODE_BIN}."
  [[ $("${NODE_BIN}" --version) == "v${NODE_VERSION}" ]] ||
    die "versão inesperada em ${NODE_BIN}."
  [[ -x ${NPM_BIN} && -f ${NPM_CLI} ]] || die "npm independente incompleto em ${NODE_ROOT}."
}

require_env_file() {
  [[ -f ${ENV_FILE} ]] || die "arquivo protegido ausente: ${ENV_FILE}."
  [[ $(stat -c '%a' "${ENV_FILE}") =~ ^(400|440|600|640)$ ]] ||
    die "${ENV_FILE} possui permissão excessiva."
}

load_env_values() {
  require_env_file
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  [[ -n ${PULSO_STORAGE_KEY:-} ]] || die "PULSO_STORAGE_KEY ausente."
}

load_env() {
  load_env_values
  [[ ${PULSO_DATA_ROOT:-} == "${STATE_ROOT}" ]] ||
    die "PULSO_DATA_ROOT deve ser ${STATE_ROOT}."
  [[ ${PULSO_PYTHON_BIN:-} == "${PYTHON_BIN}" ]] ||
    die "PULSO_PYTHON_BIN deve ser ${PYTHON_BIN}."
}

assert_under() {
  local candidate base resolved_candidate resolved_base
  candidate=$1
  base=$2
  resolved_candidate=$(realpath -m -- "${candidate}")
  resolved_base=$(realpath -m -- "${base}")
  [[ ${resolved_candidate} == "${resolved_base}" || ${resolved_candidate} == "${resolved_base}/"* ]] ||
    die "caminho fora do escopo autorizado: ${candidate}."
}

assert_not_symlink() {
  [[ ! -L $1 ]] || die "link simbólico não permitido: $1."
}

current_release() {
  [[ -L ${CURRENT_LINK} ]] || die "${CURRENT_LINK} ainda não aponta para um release."
  local resolved
  resolved=$(realpath -e -- "${CURRENT_LINK}")
  assert_under "${resolved}" "${RELEASES_ROOT}"
  printf '%s\n' "${resolved}"
}

run_as_service() {
  if [[ ${TEST_MODE} == "1" ]]; then
    "$@"
  else
    runuser -u "${SERVICE_USER}" -- "$@"
  fi
}

run_npm() {
  PATH="${NODE_ROOT}/bin:${PATH}" \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false \
    "${NODE_BIN}" "${NPM_CLI}" "$@"
}

run_storage() {
  local release=$1
  shift
  run_as_service env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    PULSO_PYTHON_BIN="${PULSO_PYTHON_BIN}" \
    "${NODE_BIN}" "${release}/src/storage/cli.mjs" "$@"
}

verify_safe_state() {
  local release
  release=$(current_release)
  load_env
  run_as_service env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${release}/tools/verify-safe-state.mjs" "${release}"
}

publish_public() {
  local release=$1 backup stage web_parent
  LAST_PUBLIC_BACKUP=""
  [[ -f "${release}/dist/production/index.html" ]] ||
    die "artefato de produção ausente em ${release}/dist/production."
  web_parent=$(dirname "${WEB_ROOT}")
  [[ -d ${web_parent} && ! -L ${web_parent} ]] ||
    die "${web_parent} deve existir como diretório real compartilhado."
  stage="${WEB_ROOT}.stage.$$"
  assert_under "${stage}" "${web_parent}"
  [[ ! -e ${stage} ]] || die "staging inesperado já existe: ${stage}."
  if [[ ${TEST_MODE} == "1" ]]; then
    install -d -m 0750 "${stage}"
  else
    install -d -o "${SERVICE_USER}" -g www-data -m 0750 "${stage}"
  fi
  cp -a "${release}/dist/production/." "${stage}/"
  find "${stage}" -type d -exec chmod 0750 {} +
  find "${stage}" -type f -exec chmod 0640 {} +
  if [[ ${TEST_MODE} != "1" ]]; then
    chown -R "${SERVICE_USER}:www-data" "${stage}"
  fi

  if [[ -e ${WEB_ROOT} ]]; then
    backup="${STATE_ROOT}/backups/public-$(date -u +%Y%m%dT%H%M%SZ)"
    assert_under "${backup}" "${STATE_ROOT}/backups"
    [[ ! -e ${backup} ]] || die "backup inesperado já existe: ${backup}."
    mv -- "${WEB_ROOT}" "${backup}"
    if ! mv -- "${stage}" "${WEB_ROOT}"; then
      mv -- "${backup}" "${WEB_ROOT}"
      die "falha ao ativar conteúdo público; versão anterior restaurada."
    fi
    LAST_PUBLIC_BACKUP="${backup}"
    log "backup público anterior: ${backup}"
  else
    mv -- "${stage}" "${WEB_ROOT}"
  fi
}

restore_public_backup() {
  local backup=$1 failed
  [[ -n ${backup} && -d ${backup} ]] || die "backup público válido não informado."
  assert_under "${backup}" "${STATE_ROOT}/backups"
  failed="${STATE_ROOT}/backups/public-rejected-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ ! -e ${failed} ]] || die "destino de preservação inesperado: ${failed}."
  if [[ -e ${WEB_ROOT} ]]; then
    mv -- "${WEB_ROOT}" "${failed}"
  fi
  mv -- "${backup}" "${WEB_ROOT}"
  log "conteúdo público rejeitado preservado em ${failed}"
}

prepare_release_permissions() {
  local release=$1
  assert_under "${release}" "${RELEASES_ROOT}"
  if [[ ${TEST_MODE} == "1" ]]; then
    install -d -m 0770 \
      "${release}/content" \
      "${release}/public" \
      "${release}/public/assets"
  else
    install -d -o root -g "${SERVICE_GROUP}" -m 0770 \
      "${release}/content" \
      "${release}/public" \
      "${release}/public/assets"
  fi
  chgrp -R "${SERVICE_GROUP}" "${release}/content" "${release}/public"
  find "${release}/content" "${release}/public" -type d -exec chmod 2770 {} +
  log "diretórios editoriais mutáveis preparados para ${SERVICE_USER}"
}

activate_staged_storage() {
  local active_data=$1 activation=$2 snapshot_id=$3
  if [[ -e ${active_data} ]]; then
    [[ -d ${active_data} && ! -L ${active_data} ]] ||
      die "storage/data ativo não é diretório real; ativação cancelada."
    if [[ -n $(find "${active_data}" -mindepth 1 ! -type d -print -quit) ]]; then
      die "storage/data contém arquivos, links ou estado ativo; ativação cancelada."
    fi
    if [[ -e "${active_data}/snapshots/${snapshot_id}" ]]; then
      die "snapshot ${snapshot_id} já existe no estado ativo; nenhuma sobrescrita será feita."
    fi
    if [[ ${TEST_MODE} == "1" ]]; then
      install -d -m 0750 "${active_data}/snapshots"
    else
      install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${active_data}/snapshots"
    fi
    mv -- "${activation}/storage/data/operational.sqlcipher" "${active_data}/"
    mv -- "${activation}/storage/data/operational.json" "${active_data}/"
    if [[ -f "${activation}/storage/data/operational-migration.json" ]]; then
      mv -- "${activation}/storage/data/operational-migration.json" "${active_data}/"
    fi
    mv -- "${activation}/storage/data/snapshots/${snapshot_id}" \
      "${active_data}/snapshots/"
  else
    mv -- "${activation}/storage/data" "${active_data}"
  fi
  rmdir -- "${activation}/storage/data/snapshots" 2>/dev/null || true
  rmdir -- "${activation}/storage/data" 2>/dev/null || true
  rmdir -- "${activation}/storage" 2>/dev/null || true
  rmdir -- "${activation}" 2>/dev/null || true
}
