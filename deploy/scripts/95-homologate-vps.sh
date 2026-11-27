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
require_command curl
require_command nginx
load_env

domain=${1:-pulsobit.tech}
root=$(repo_root)

run_storage "${root}" verify
runuser -u "${SERVICE_USER}" -- env \
  PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
  PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
  "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${root}" "${root}/deploy/pd0072-expected-counts.json"
verify_safe_state

[[ $(find "${WEB_ROOT}" -type f -name '*.html' | wc -l) -eq 19 ]] || die "esperadas 19 páginas HTML."
[[ $(find "${WEB_ROOT}/noticias" -type f -name '*.html' | wc -l) -eq 8 ]] || die "esperadas 8 matérias."
[[ $(find "${WEB_ROOT}/categorias" -type f -name '*.html' | wc -l) -eq 5 ]] || die "esperadas 5 editorias."
[[ $(grep -o '<item>' "${WEB_ROOT}/rss.xml" | wc -l) -eq 8 ]] || die "RSS deve ter 8 itens."
if find "${WEB_ROOT}" -type f | grep -Eq '\.(sqlcipher|sqlite|db|key|pem|env)$'; then
  die "arquivo privado encontrado no web root."
fi

nginx -t
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  die "serviço permanente está ativo; operação deve permanecer pausada."
fi

origin_args=(--resolve "${domain}:443:127.0.0.1" --fail --silent --show-error)
curl "${origin_args[@]}" "https://${domain}/" | grep -q 'PulsoBit'
curl "${origin_args[@]}" "https://${domain}/" | grep -q 'rel="canonical" href="https://pulsobit.tech/"'
curl "${origin_args[@]}" "https://${domain}/noticias/gta-vi-lancamento-vice-city.html" | grep -q 'GTA VI'
curl "${origin_args[@]}" "https://${domain}/rss.xml" | grep -q '<rss'
curl "${origin_args[@]}" "https://${domain}/sitemap.xml" | grep -q '<urlset'
curl "${origin_args[@]}" "https://${domain}/robots.txt" | grep -q 'Disallow: /'
curl --fail --silent --show-error "https://${domain}/" | grep -q 'noindex,follow'
curl --head --fail --silent --show-error "https://www.${domain}/" | grep -qi '^location: https://pulsobit.tech/'

log "homologação não destrutiva concluída; automação, IA, indexação e publicidade permanecem desativadas"
