#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_node_runtime
require_release

root=$(repo_root)
activate=false
case "${1:-}" in
  "") ;;
  --activate) activate=true ;;
  *) die "uso: $0 [--activate]" ;;
esac

(
  cd -- "${root}"
  run_npm run build:production
  run_npm run verify:production
)

if [[ ${activate} == true ]]; then
  load_env
  verify_safe_state
  publish_public "${root}"
  log "conteúdo público ativado em ${WEB_ROOT}"
else
  log "build validado em ${root}/dist/production; use --activate após revisão"
fi
