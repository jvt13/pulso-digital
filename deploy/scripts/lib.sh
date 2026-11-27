#!/usr/bin/env bash
set -euo pipefail

readonly APP_NAME="pulso-digital"
readonly APP_ROOT="/opt/pulso-digital"
readonly RELEASES_ROOT="${APP_ROOT}/releases"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly RUNTIME_ROOT="${APP_ROOT}/runtime"
readonly VENV_ROOT="${APP_ROOT}/venv"
readonly STATE_ROOT="/var/lib/pulso-digital"
readonly CONFIG_ROOT="/etc/pulso-digital"
readonly ENV_FILE="${CONFIG_ROOT}/pulso.env"
readonly WEB_ROOT="/var/www/pulso-digital"
readonly SERVICE_NAME="pulso-digital"
readonly SERVICE_USER="pulso-digital"
readonly SERVICE_GROUP="pulso-digital"
readonly NODE_VERSION="24.22.3"
readonly NODE_SHA256="4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb"
readonly NODE_ROOT="${RUNTIME_ROOT}/node-v${NODE_VERSION}-linux-x64"
readonly NODE_BIN="${NODE_ROOT}/bin/node"
readonly NPM_BIN="${NODE_ROOT}/bin/npm"
readonly NPM_CLI="${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
readonly PYTHON_BIN="${VENV_ROOT}/bin/python"

log() {
  printf '[pulsobit] %s\n' "$*"
}

die() {
  printf '[pulsobit] ERRO: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID} -eq 0 ]] || die "execute esta etapa como root por um terminal autorizado."
}

require_ubuntu_2404() {
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
  runuser -u "${SERVICE_USER}" -- "$@"
}

run_npm() {
  "${NODE_BIN}" "${NPM_CLI}" "$@"
}

run_storage() {
  local release=$1
  shift
  runuser -u "${SERVICE_USER}" -- env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    PULSO_PYTHON_BIN="${PULSO_PYTHON_BIN}" \
    "${NODE_BIN}" "${release}/src/storage/cli.mjs" "$@"
}

verify_safe_state() {
  local release
  release=$(current_release)
  load_env
  runuser -u "${SERVICE_USER}" -- env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${release}/tools/verify-safe-state.mjs" "${release}"
}

publish_public() {
  local release=$1 backup stage
  [[ -f "${release}/dist/production/index.html" ]] ||
    die "artefato de produção ausente em ${release}/dist/production."
  install -d -o root -g www-data -m 0755 "$(dirname "${WEB_ROOT}")"
  stage="${WEB_ROOT}.stage.$$"
  assert_under "${stage}" "/var/www"
  [[ ! -e ${stage} ]] || die "staging inesperado já existe: ${stage}."
  install -d -o root -g www-data -m 0755 "${stage}"
  cp -a "${release}/dist/production/." "${stage}/"
  find "${stage}" -type d -exec chmod 0755 {} +
  find "${stage}" -type f -exec chmod 0644 {} +
  chown -R root:www-data "${stage}"

  if [[ -e ${WEB_ROOT} ]]; then
    backup="${STATE_ROOT}/backups/public-$(date -u +%Y%m%dT%H%M%SZ)"
    assert_under "${backup}" "${STATE_ROOT}/backups"
    [[ ! -e ${backup} ]] || die "backup inesperado já existe: ${backup}."
    mv -- "${WEB_ROOT}" "${backup}"
    if ! mv -- "${stage}" "${WEB_ROOT}"; then
      mv -- "${backup}" "${WEB_ROOT}"
      die "falha ao ativar conteúdo público; versão anterior restaurada."
    fi
    log "backup público anterior: ${backup}"
  else
    mv -- "${stage}" "${WEB_ROOT}"
  fi
}
