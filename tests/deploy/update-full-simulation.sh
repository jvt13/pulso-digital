#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
NODE_RUNTIME=${PULSO_TEST_NODE_RUNTIME:-}
[[ -x ${NODE_RUNTIME}/bin/node ]] ||
  { printf 'PULSO_TEST_NODE_RUNTIME deve apontar para Node.js 24.22.3 Linux.\n' >&2; exit 1; }
[[ $("${NODE_RUNTIME}/bin/node" --version) == "v24.22.3" ]] ||
  { printf 'Runtime de teste deve ser Node.js v24.22.3.\n' >&2; exit 1; }
[[ $(id -u) -ne 0 ]] ||
  { printf 'A simulação deve ser executada por usuário sem privilégios administrativos.\n' >&2; exit 1; }
[[ -f "${REPO_ROOT}/.env" ]] ||
  { printf '.env local ausente para a fixture cifrada.\n' >&2; exit 1; }

TEST_ROOT=$(mktemp -d /tmp/pulso-deploy-test.full.XXXXXX)
cleanup() {
  [[ ${TEST_ROOT} == /tmp/pulso-deploy-test.* ]] || exit 1
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

export PULSO_DEPLOY_TEST_MODE=1
export PULSO_DEPLOY_TEST_ROOT="${TEST_ROOT}"
export PULSO_DEPLOY_TEST_USER="$(id -un)"

APP_ROOT="${TEST_ROOT}/opt/pulso-digital"
STATE_ROOT="${TEST_ROOT}/var/lib/pulso-digital"
ENV_ROOT="${TEST_ROOT}/etc/pulso-digital"
WEB_PARENT="${TEST_ROOT}/var/www"
NODE_LINK="${APP_ROOT}/runtime/node-v24.22.3-linux-x64"
CURRENT_LINK="${APP_ROOT}/current"
CURRENT="${APP_ROOT}/releases/current"
TARGET="${APP_ROOT}/releases/target"
FAIL_TARGET="${APP_ROOT}/releases/target-fail"

install -d "${APP_ROOT}/releases" "${APP_ROOT}/runtime" "${APP_ROOT}/venv/bin" \
  "${STATE_ROOT}/storage/data" "${STATE_ROOT}/backups" "${ENV_ROOT}" "${WEB_PARENT}" \
  "${TEST_ROOT}/bin"
ln -s "${NODE_RUNTIME}" "${NODE_LINK}"
ln -s /usr/bin/python3 "${APP_ROOT}/venv/bin/python"

cp "${REPO_ROOT}/storage/data/operational.sqlcipher" "${STATE_ROOT}/storage/data/"
cp "${REPO_ROOT}/storage/data/operational.json" "${STATE_ROOT}/storage/data/"
cp "${REPO_ROOT}/storage/data/operational-migration.json" "${STATE_ROOT}/storage/data/"
find "${STATE_ROOT}" -name state.json -print -quit | grep -q . &&
  { printf 'Arquivo legado inesperado na fixture.\n' >&2; exit 1; }

key_line=$(grep -m1 '^PULSO_STORAGE_KEY=' "${REPO_ROOT}/.env")
[[ -n ${key_line} ]] || { printf 'Chave de teste ausente no .env local.\n' >&2; exit 1; }
(
  umask 077
  printf '%s\n' "${key_line}" >"${ENV_ROOT}/pulso.env"
  printf 'PULSO_DATA_ROOT=%s\n' "${STATE_ROOT}" >>"${ENV_ROOT}/pulso.env"
  printf 'PULSO_PYTHON_BIN=%s\n' "${APP_ROOT}/venv/bin/python" >>"${ENV_ROOT}/pulso.env"
)
chmod 0600 "${ENV_ROOT}/pulso.env"

cat >"${TEST_ROOT}/bin/systemctl" <<'STUB'
#!/bin/sh
case "${1:-}" in
  is-active) exit 1 ;;
  reload) exit 0 ;;
  *) exit 0 ;;
esac
STUB
cat >"${TEST_ROOT}/bin/nginx" <<'STUB'
#!/bin/sh
exit 0
STUB
cat >"${TEST_ROOT}/bin/curl" <<STUB
#!/bin/sh
current=\$(readlink "${CURRENT_LINK}" 2>/dev/null || true)
case "\${current}" in
  *target-fail) exit 7 ;;
esac
for argument in "\$@"; do
  if [ "\${argument}" = "--head" ]; then
    printf '%s\n' 'location: https://pulsobit.tech/'
    exit 0
  fi
done
printf '%s\n' 'PulsoBit rel="canonical" href="https://pulsobit.tech/" GTA VI <rss <urlset Disallow: / noindex,follow location: https://pulsobit.tech/'
STUB
chmod 0755 "${TEST_ROOT}/bin/systemctl" "${TEST_ROOT}/bin/nginx" "${TEST_ROOT}/bin/curl"
export PATH="${TEST_ROOT}/bin:${PATH}"

git clone --quiet "${REPO_ROOT}" "${CURRENT}"
git -C "${CURRENT}" checkout --quiet a2624e7
git clone --quiet "${REPO_ROOT}" "${TARGET}"
tar -C "${REPO_ROOT}" \
  --exclude=.git --exclude=node_modules --exclude=dist --exclude=reports \
  --exclude=storage/data --exclude=storage/archive --exclude=.env --exclude='.env.*' \
  -cf - . | tar -C "${TARGET}" -xf -
git -C "${TARGET}" add -A
git -C "${TARGET}" -c user.name=PulsoTest -c user.email=pulso@example.invalid \
  commit --quiet -m "sandbox updater fix"
target_commit=$(git -C "${TARGET}" rev-parse HEAD)
ln -s "${CURRENT}" "${CURRENT_LINK}"

(
  cd "${TARGET}"
  PATH="${NODE_RUNTIME}/bin:${PATH}" \
    "${NODE_RUNTIME}/bin/node" "${NODE_RUNTIME}/lib/node_modules/npm/bin/npm-cli.js" \
    ci --ignore-scripts --no-audit --no-fund
)
cp -a "${TARGET}/node_modules" "${CURRENT}/node_modules"

run_interactive() {
  python3 - "$@" <<'PY'
import errno
import os
import pty
import select
import sys

command = sys.argv[1:]
prompts = [
    ("Digite PREPARAR", "PREPARAR\n"),
    ("Confirmação final", "CONFIRMAR\n"),
    ("Digite ROLLBACK", "ROLLBACK\n"),
]
pid, descriptor = pty.fork()
if pid == 0:
    os.execvpe(command[0], command, os.environ)
buffer = b""
sent = set()
status = None
while True:
    try:
        ready, _, _ = select.select([descriptor], [], [], 1)
    except InterruptedError:
        continue
    if ready:
        try:
            chunk = os.read(descriptor, 4096)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        buffer += chunk
        for index, (marker, answer) in enumerate(prompts):
            if index not in sent and marker.encode() in buffer:
                os.write(descriptor, answer.encode())
                sent.add(index)
    if status is None:
        waited, raw_status = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = raw_status
            if not ready:
                break
if status is None:
    _, status = os.waitpid(pid, 0)
raise SystemExit(os.waitstatus_to_exitcode(status))
PY
}

printf 'FULL_UPDATE_STEP=dry-run\n'
run_interactive /bin/bash "${TARGET}/deploy/scripts/96-switch-release.sh" \
  --release "${TARGET}" --commit "${target_commit}" --dry-run
[[ $(readlink "${CURRENT_LINK}") == "${CURRENT}" ]]

printf 'FULL_UPDATE_STEP=apply\n'
run_interactive /bin/bash "${TARGET}/deploy/scripts/96-switch-release.sh" \
  --release "${TARGET}" --commit "${target_commit}" --confirm
[[ $(readlink "${CURRENT_LINK}") == "${TARGET}" ]]
[[ $(find "${TEST_ROOT}/var/www/pulso-digital" -type f -name '*.html' | wc -l) -eq 19 ]]
[[ $(find "${TEST_ROOT}/var/lib/pulso-digital/storage/data/snapshots" -mindepth 1 -maxdepth 1 -type d | wc -l) -ge 1 ]]
web_hash_after_success=$(sha256sum "${TEST_ROOT}/var/www/pulso-digital/index.html" | awk '{print $1}')

git clone --quiet "${REPO_ROOT}" "${FAIL_TARGET}"
tar -C "${REPO_ROOT}" \
  --exclude=.git --exclude=node_modules --exclude=dist --exclude=reports \
  --exclude=storage/data --exclude=storage/archive --exclude=.env --exclude='.env.*' \
  -cf - . | tar -C "${FAIL_TARGET}" -xf -
node_fail="${FAIL_TARGET}/package.json"
lock_fail="${FAIL_TARGET}/package-lock.json"
sed -i 's/"version": "1.6.0"/"version": "1.6.1"/' "${node_fail}" "${lock_fail}"
git -C "${FAIL_TARGET}" add -A
git -C "${FAIL_TARGET}" -c user.name=PulsoTest -c user.email=pulso@example.invalid \
  commit --quiet -m "sandbox forced failure target"
fail_commit=$(git -C "${FAIL_TARGET}" rev-parse HEAD)

printf 'FULL_UPDATE_STEP=forced-post-activation-failure\n'
set +e
run_interactive /bin/bash "${FAIL_TARGET}/deploy/scripts/96-switch-release.sh" \
  --release "${FAIL_TARGET}" --commit "${fail_commit}" --confirm
failure_status=$?
set -e
[[ ${failure_status} -ne 0 ]]
[[ $(readlink "${CURRENT_LINK}") == "${TARGET}" ]]
[[ $(sha256sum "${TEST_ROOT}/var/www/pulso-digital/index.html" | awk '{print $1}') == "${web_hash_after_success}" ]]

printf 'FULL_UPDATE_STEP=explicit-rollback\n'
run_interactive /bin/bash "${TARGET}/deploy/scripts/97-rollback-release.sh" \
  --release "${CURRENT}" --commit "$(git -C "${CURRENT}" rev-parse HEAD)" --confirm
[[ $(readlink "${CURRENT_LINK}") == "${CURRENT}" ]]

printf 'FULL_UPDATE_SIMULATION_OK\n'
