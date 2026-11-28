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
baseline_file=${2:-}
root=$(repo_root)
verification_root=${3:-${root}}
[[ -d ${verification_root} ]] || die "release de verificação ausente: ${verification_root}."

run_storage "${root}" verify
if [[ -n ${baseline_file} ]]; then
  [[ -f ${baseline_file} && ! -L ${baseline_file} ]] ||
    die "linha de base dinâmica inválida: ${baseline_file}."
  current_metrics=$(mktemp "${STATE_ROOT}/metrics-current.XXXXXX")
  trap 'rm -f -- "${current_metrics}"' EXIT
  chmod 0600 "${current_metrics}"
  run_storage "${root}" metrics --json >"${current_metrics}"
  "${NODE_BIN}" "${root}/tools/verify-metrics-baseline.mjs" \
    "${baseline_file}" "${current_metrics}"
  rm -f -- "${current_metrics}"
  trap - EXIT
else
  runuser -u "${SERVICE_USER}" -- env \
    PULSO_STORAGE_KEY="${PULSO_STORAGE_KEY}" \
    PULSO_DATA_ROOT="${PULSO_DATA_ROOT}" \
    "${NODE_BIN}" "${root}/tools/verify-expected-state.mjs" "${verification_root}" "${root}/deploy/pd0072-expected-counts.json"
fi
verify_safe_state

html_pages=$(find "${WEB_ROOT}" -type f -name '*.html' | wc -l)
articles=$(find "${WEB_ROOT}/noticias" -type f -name '*.html' | wc -l)
categories=$(find "${WEB_ROOT}/categorias" -type f -name '*.html' | wc -l)
rss_items=$(grep -o '<item>' "${WEB_ROOT}/rss.xml" | wc -l)
[[ ${html_pages} -eq 19 ]] || die "esperadas 19 páginas HTML; encontradas ${html_pages}."
[[ ${articles} -eq 8 ]] || die "esperadas 8 matérias; encontradas ${articles}."
[[ ${categories} -eq 5 ]] || die "esperadas 5 editorias; encontradas ${categories}."
[[ ${rss_items} -eq 8 ]] || die "RSS deve ter 8 itens; encontrados ${rss_items}."
if find "${WEB_ROOT}" -type f | grep -Eq '\.(sqlcipher|sqlite|db|key|pem|env)$'; then
  die "arquivo privado encontrado no web root."
fi

nginx -t || die "configuração Nginx inválida."
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  die "serviço permanente está ativo; operação deve permanecer pausada."
fi

origin_args=(--resolve "${domain}:443:127.0.0.1" --fail --silent --show-error)
curl "${origin_args[@]}" "https://${domain}/" | grep -q 'PulsoBit' ||
  die "home pública não contém PulsoBit."
curl "${origin_args[@]}" "https://${domain}/" | grep -q 'rel="canonical" href="https://pulsobit.tech/"' ||
  die "canonical da home está incorreto."
curl "${origin_args[@]}" "https://${domain}/noticias/gta-vi-lancamento-vice-city.html" | grep -q 'GTA VI' ||
  die "matéria pública de homologação não foi encontrada."
curl "${origin_args[@]}" "https://${domain}/rss.xml" | grep -q '<rss' ||
  die "RSS público inválido."
curl "${origin_args[@]}" "https://${domain}/sitemap.xml" | grep -q '<urlset' ||
  die "sitemap público inválido."
curl "${origin_args[@]}" "https://${domain}/robots.txt" | grep -q 'Disallow: /' ||
  die "robots.txt não bloqueia indexação."
curl --fail --silent --show-error "https://${domain}/" | grep -q 'noindex,follow' ||
  die "home pública não está com noindex."
curl --head --fail --silent --show-error "https://www.${domain}/" | grep -qi '^location: https://pulsobit.tech/' ||
  die "redirecionamento de www não foi confirmado."

log "homologação não destrutiva concluída; automação, IA, indexação e publicidade permanecem desativadas"
