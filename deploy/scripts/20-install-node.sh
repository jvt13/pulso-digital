#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_command curl
require_command sha256sum
require_command tar

install -d -o root -g root -m 0755 "${RUNTIME_ROOT}"

if [[ -x ${NODE_BIN} ]]; then
  actual=$("${NODE_BIN}" --version)
  [[ ${actual} == "v${NODE_VERSION}" ]] ||
    die "${NODE_BIN} existe com versão inesperada: ${actual}."
  log "Node.js independente ${NODE_VERSION} já está instalado"
  exit 0
fi

[[ ! -e ${NODE_ROOT} ]] || die "${NODE_ROOT} existe incompleto; inspeção manual necessária."

temp_dir=$(mktemp -d "${RUNTIME_ROOT}/.node-install.XXXXXX")
cleanup() {
  assert_under "${temp_dir}" "${RUNTIME_ROOT}"
  rm -rf -- "${temp_dir}"
}
trap cleanup EXIT

artifact="node-v${NODE_VERSION}-linux-x64.tar.xz"
base_url="https://nodejs.org/dist/v${NODE_VERSION}"
curl --fail --location --silent --show-error "${base_url}/SHASUMS256.txt" \
  --output "${temp_dir}/SHASUMS256.txt"
grep -F " ${artifact}" "${temp_dir}/SHASUMS256.txt" >/dev/null ||
  die "arquivo Node.js não encontrado no manifesto oficial."
grep -F "${NODE_SHA256}  ${artifact}" "${temp_dir}/SHASUMS256.txt" >/dev/null ||
  die "SHA-256 oficial diverge da versão homologada."
curl --fail --location --silent --show-error "${base_url}/${artifact}" \
  --output "${temp_dir}/${artifact}"
(
  cd -- "${temp_dir}"
  sha256sum --check --strict <<<"${NODE_SHA256}  ${artifact}"
)
tar -xJf "${temp_dir}/${artifact}" -C "${temp_dir}"
[[ $("${temp_dir}/node-v${NODE_VERSION}-linux-x64/bin/node" --version) == "v${NODE_VERSION}" ]] ||
  die "binário extraído reportou versão incorreta."
mv -- "${temp_dir}/node-v${NODE_VERSION}-linux-x64" "${NODE_ROOT}"
log "Node.js ${NODE_VERSION} instalado em ${NODE_ROOT}; PATH global inalterado"
