#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user
require_node_runtime
require_release

root=$(repo_root)
[[ -f "${root}/package-lock.json" ]] || die "package-lock.json ausente."

log "instalando dependências fixadas no release ${root}"
(
  cd -- "${root}"
  run_npm ci --ignore-scripts --no-audit --no-fund
)

(
  cd -- "${root}"
  runuser -u "${SERVICE_USER}" -- env PATH="${NODE_ROOT}/bin:${PATH}" \
    "${NODE_BIN}" -e "import('better-sqlite3-multiple-ciphers').then(({default:Database})=>{const db=new Database(':memory:');db.exec('CREATE TABLE probe(value TEXT)');db.prepare('INSERT INTO probe VALUES (?)').run('ok');const row=db.prepare('SELECT value FROM probe').get();if(row.value!=='ok')throw new Error('sqlite probe failed');db.close();console.log('sqlite-native-memory-ok')})"
)

log "dependências e módulo SQLite validados; nenhuma dependência global alterada"
