#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_root
require_ubuntu_2404
require_service_user
require_release
require_command python3.12

root=$(repo_root)
requirements="${root}/deploy/requirements-image.txt"
[[ -f ${requirements} ]] || die "arquivo de requisitos Python ausente."
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${VENV_ROOT}"

if [[ ! -x ${PYTHON_BIN} ]]; then
  runuser -u "${SERVICE_USER}" -- python3.12 -m venv "${VENV_ROOT}"
fi

runuser -u "${SERVICE_USER}" -- "${PYTHON_BIN}" -m pip install \
  --disable-pip-version-check --requirement "${requirements}"
version=$(runuser -u "${SERVICE_USER}" -- "${PYTHON_BIN}" -c 'from PIL import Image; print(Image.__version__)')
[[ ${version} == "13.0.0" ]] || die "Pillow inesperado: ${version}."
log "Python e Pillow ${version} validados no virtualenv exclusivo"
