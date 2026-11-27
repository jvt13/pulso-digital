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
[[ ${target_commit} =~ ^[a-f0-9]{40}$ ]] || die "commit alvo inválido."

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
[[ ${target} != "${current}" ]] || die "release informado já está ativo."
[[ -d "${target}/.git" ]] || die "release de rollback deve ser checkout Git."
[[ $(git -C "${target}" rev-parse HEAD) == "${target_commit}" ]] ||
  die "HEAD do release não corresponde ao commit de rollback."

systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null &&
  die "serviço ${SERVICE_NAME} deve permanecer inativo durante o rollback."
run_storage "${current}" verify
verify_safe_state

cat <<SUMMARY

=== Plano de rollback PulsoBit ===
Release atual: ${current}
Release alvo:  ${target}
Commit alvo:   ${target_commit}
Banco/chave:   preservados
Mutação:       código e conteúdo público
Systemd:       inalterado
Nginx:         inalterado
=================================

SUMMARY

if [[ ${mode} == "dry-run" ]]; then
  log "dry-run de rollback concluído; nada foi alterado"
  exit 0
fi

[[ -r /dev/tty ]] || die "rollback exige terminal interativo."
printf 'Digite ROLLBACK para confirmar: ' >/dev/tty
IFS= read -r answer </dev/tty
[[ ${answer} == "ROLLBACK" ]] || die "rollback não confirmado."

checkpoint_output=$(run_storage "${current}" checkpoint)
checkpoint_id=$(printf '%s\n' "${checkpoint_output}" | sed -n 's/.*"snapshotId": "\([^"]*\)".*/\1/p' | head -n 1)
[[ ${checkpoint_id} =~ ^[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}$ ]] ||
  die "checkpoint de rollback não confirmado."

install -d -o root -g "${SERVICE_GROUP}" -m 0770 "${target}/content" "${target}/public"
cp -a "${current}/content/." "${target}/content/"
cp -a "${current}/public/." "${target}/public/"
current_lock=$(sha256sum "${current}/package-lock.json" | awk '{print $1}')
target_lock=$(sha256sum "${target}/package-lock.json" | awk '{print $1}')
if [[ -d "${current}/node_modules" && ${current_lock} == "${target_lock}" && ! -d "${target}/node_modules" ]]; then
  cp -a "${current}/node_modules" "${target}/node_modules"
else
  (
    cd -- "${target}"
    run_npm ci --ignore-scripts
  )
fi
(
  cd -- "${target}"
  run_npm run build:production
  run_npm run verify:production
)
prepare_release_permissions "${target}"

previous=${current}
activation_started=false
restore_previous_code() {
  ln -s "${previous}" "${APP_ROOT}/.current.rollback.back.$$"
  mv -Tf "${APP_ROOT}/.current.rollback.back.$$" "${CURRENT_LINK}"
}
on_exit_rollback() {
  local status=$?
  trap - EXIT
  if [[ ${activation_started} == true && ${status} -ne 0 ]]; then
    set +e
    restore_previous_code
    if [[ -n ${LAST_PUBLIC_BACKUP} ]]; then
      restore_public_backup "${LAST_PUBLIC_BACKUP}"
    fi
    log "falha no rollback; estado anterior restaurado"
  fi
  exit "${status}"
}
trap on_exit_rollback EXIT

ln -s "${target}" "${APP_ROOT}/.current.rollback.$$"
mv -Tf "${APP_ROOT}/.current.rollback.$$" "${CURRENT_LINK}"
activation_started=true
publish_public "${target}"
if ! (
  run_storage "${target}" verify
  run_as_service env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${target}/tools/verify-safe-state.mjs" "${target}"
  "${target}/deploy/scripts/95-homologate-vps.sh" pulsobit.tech
); then
  die "verificação pós-rollback falhou; código anterior será restaurado."
fi

activation_started=false
trap - EXIT
log "rollback concluído com checkpoint ${checkpoint_id}; banco e chave não foram alterados"
