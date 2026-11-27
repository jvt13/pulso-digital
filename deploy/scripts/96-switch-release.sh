#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

mode="dry-run"
release_arg=""
target_commit=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      [[ -n ${2:-} ]] || die "--release exige um diretório."
      release_arg=$2
      shift 2
      ;;
    --commit)
      [[ -n ${2:-} ]] || die "--commit exige um SHA."
      target_commit=$2
      shift 2
      ;;
    --dry-run) mode="dry-run"; shift ;;
    --confirm) mode="apply"; shift ;;
    *) die "argumento desconhecido: $1." ;;
  esac
done

[[ -n ${release_arg} ]] || die "uso: $0 --release DIR --commit SHA [--dry-run|--confirm]"
[[ ${target_commit} =~ ^[a-f0-9]{40}$ ]] || die "commit alvo deve ter 40 caracteres hexadecimais."

require_root
require_ubuntu_2404
require_service_user
require_node_runtime
require_command git
require_command systemctl
load_env

current=$(current_release)
target=$(realpath -e -- "${release_arg}")
assert_under "${target}" "${RELEASES_ROOT}"
[[ ${target} != "${current}" ]] || die "o release informado já está ativo."
[[ -d "${target}/.git" ]] || die "release alvo deve ser um checkout Git verificável."
[[ $(git -C "${target}" rev-parse HEAD) == "${target_commit}" ]] ||
  die "HEAD do release não corresponde ao commit alvo."
[[ -z $(git -C "${target}" status --porcelain) ]] ||
  die "release alvo possui alterações locais antes da atualização."

current_version=$("${NODE_BIN}" -e 'process.stdout.write(require(process.argv[1]).version)' "${current}/package.json")
target_version=$("${NODE_BIN}" -e 'process.stdout.write(require(process.argv[1]).version)' "${target}/package.json")
"${NODE_BIN}" -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(b[i]>a[i])process.exit(0);if(b[i]<a[i])process.exit(1)}process.exit(1)' \
  "${current_version}" "${target_version}" ||
  die "a versão de destino deve ser maior que ${current_version}."

systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null &&
  die "serviço ${SERVICE_NAME} deve permanecer inativo durante a atualização."
run_storage "${current}" verify
run_as_service env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
  "${NODE_BIN}" "${current}/tools/verify-expected-state.mjs" "${current}" "${current}/deploy/pd0072-expected-counts.json"
verify_safe_state

available_kb=$(df -Pk "${APP_ROOT}" | awk 'NR==2 {print $4}')
[[ ${available_kb} -ge 1048576 ]] ||
  die "espaço livre insuficiente em ${APP_ROOT}; mínimo 1 GiB."

current_lock=$(sha256sum "${current}/package-lock.json" | awk '{print $1}')
target_lock=$(sha256sum "${target}/package-lock.json" | awk '{print $1}')
dependency_action="npm-ci"
if [[ -d "${current}/node_modules" && ${current_lock} == "${target_lock}" ]]; then
  dependency_action="reuse-current-node_modules"
fi

cat <<SUMMARY

=== Plano de atualização PulsoBit ===
Versão atual: ${current_version}
Versão alvo:  ${target_version}
Commit atual: $(git -C "${current}" rev-parse HEAD 2>/dev/null || printf 'desconhecido')
Commit alvo:  ${target_commit}
Release atual: ${current}
Release alvo:  ${target}
Dependências:  ${dependency_action}
Banco/chave:   preservados, sem reinstalação
Systemd:       inalterado
Nginx:         inalterado
Confirmação:   obrigatória antes da troca
======================================

SUMMARY

if [[ ${mode} == "dry-run" ]]; then
  log "dry-run concluído; nenhuma alteração foi realizada"
  exit 0
fi

[[ -r /dev/tty ]] || die "modo de aplicação exige terminal interativo."
printf 'Digite PREPARAR para criar checkpoint e preparar a release: ' >/dev/tty
IFS= read -r answer </dev/tty
[[ ${answer} == "PREPARAR" ]] || die "preparação não confirmada."

checkpoint_output=$(run_storage "${current}" checkpoint)
checkpoint_id=$(printf '%s\n' "${checkpoint_output}" | sed -n 's/.*"snapshotId": "\([^"]*\)".*/\1/p' | head -n 1)
[[ ${checkpoint_id} =~ ^[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}$ ]] ||
  die "não foi possível confirmar o checkpoint pré-atualização."
log "checkpoint criado: ${checkpoint_id}"

install -d -o root -g "${SERVICE_GROUP}" -m 0770 "${target}/content" "${target}/public"
cp -a "${current}/content/." "${target}/content/"
cp -a "${current}/public/." "${target}/public/"

if [[ ${dependency_action} == "reuse-current-node_modules" && ! -d "${target}/node_modules" ]]; then
  cp -a "${current}/node_modules" "${target}/node_modules"
else
  (
    cd -- "${target}"
    run_npm ci
  )
fi

(
  cd -- "${target}"
  run_npm run build:production
  run_npm run verify:production
)
prepare_release_permissions "${target}"

cat <<SUMMARY

=== Release preparada ===
Versão: ${target_version}
Commit: ${target_commit}
Checkpoint: ${checkpoint_id}
Matérias: 8
Editorias: 5
HTML: 19
Indexação: desativada
Publicidade: desativada
Automação após troca: parada e pausada
Digite CONFIRMAR para trocar código e conteúdo público.
=========================

SUMMARY
printf 'Confirmação final: ' >/dev/tty
IFS= read -r answer </dev/tty
[[ ${answer} == "CONFIRMAR" ]] || die "ativação não confirmada."

previous=${current}
activation_started=false

on_exit_rollback() {
  local status=$?
  trap - EXIT
  if [[ ${activation_started} == true && ${status} -ne 0 ]]; then
    set +e
    restore_previous_code
    if [[ -n ${LAST_PUBLIC_BACKUP} ]]; then
      restore_public_backup "${LAST_PUBLIC_BACKUP}"
    fi
    log "falha pós-ativação; código e público anteriores restaurados"
  fi
  exit "${status}"
}
trap on_exit_rollback EXIT

restore_previous_code() {
  ln -s "${previous}" "${APP_ROOT}/.current.rollback.$$"
  mv -Tf "${APP_ROOT}/.current.rollback.$$" "${CURRENT_LINK}"
}

ln -s "${target}" "${APP_ROOT}/.current.update.$$"
mv -Tf "${APP_ROOT}/.current.update.$$" "${CURRENT_LINK}"
activation_started=true
publish_public "${target}"

if ! (
  run_storage "${target}" verify
  run_as_service env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${target}/tools/verify-expected-state.mjs" "${target}" "${target}/deploy/pd0072-expected-counts.json"
  run_as_service env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${target}/tools/verify-safe-state.mjs" "${target}"
  "${target}/deploy/scripts/95-homologate-vps.sh" pulsobit.tech
); then
  die "verificação pós-atualização falhou; release anterior restaurada."
fi

activation_started=false
trap - EXIT
log "atualização ${current_version} -> ${target_version} concluída e homologada"
log "release anterior preservada em ${previous}"
log "banco, chave, Nginx, Systemd e automação não foram reiniciados"
