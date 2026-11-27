#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/pulso-deploy-test.update-dry.XXXXXX)
cleanup() {
  [[ ${TEST_ROOT} == /tmp/pulso-deploy-test.* ]] || exit 1
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

export PULSO_DEPLOY_TEST_MODE=1
export PULSO_DEPLOY_TEST_ROOT="${TEST_ROOT}"

install -d "${TEST_ROOT}/opt/pulso-digital/releases/current/content" \
  "${TEST_ROOT}/opt/pulso-digital/releases/current/public" \
  "${TEST_ROOT}/opt/pulso-digital/releases/current/tools" \
  "${TEST_ROOT}/opt/pulso-digital/releases/current/src/storage" \
  "${TEST_ROOT}/opt/pulso-digital/releases/target/content" \
  "${TEST_ROOT}/opt/pulso-digital/releases/target/public" \
  "${TEST_ROOT}/opt/pulso-digital/releases/target/tools" \
  "${TEST_ROOT}/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin" \
  "${TEST_ROOT}/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/lib/node_modules/npm/bin" \
  "${TEST_ROOT}/opt/pulso-digital/venv/bin" \
  "${TEST_ROOT}/var/lib/pulso-digital" \
  "${TEST_ROOT}/etc/pulso-digital"

node_stub="${TEST_ROOT}/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin/node"
cat > "${node_stub}" <<'NODE_STUB'
#!/usr/bin/env python3
import json
import sys

if len(sys.argv) > 1 and sys.argv[1] == "--version":
    print("v24.22.3")
    raise SystemExit(0)
if len(sys.argv) > 2 and sys.argv[1] == "-e":
    code = sys.argv[2]
    args = sys.argv[3:]
    if "require(process.argv[1]).version" in code:
        print(json.load(open(args[0], encoding="utf-8"))["version"], end="")
        raise SystemExit(0)
    if "const a=process.argv[1].split" in code:
        current = [int(x) for x in args[0].split(".")]
        target = [int(x) for x in args[1].split(".")]
        raise SystemExit(0 if target > current else 1)
print('{"ok":true,"snapshotId":"20260101T000000000Z-00000000"}')
NODE_STUB
chmod 0755 "${node_stub}"
ln -s node "${TEST_ROOT}/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/bin/npm"
touch "${TEST_ROOT}/opt/pulso-digital/runtime/node-v24.22.3-linux-x64/lib/node_modules/npm/bin/npm-cli.js"

for release in current target; do
  version=1.5.2
  [[ ${release} == target ]] && version=1.6.0
  cat > "${TEST_ROOT}/opt/pulso-digital/releases/${release}/package.json" <<EOF
{"name":"pulso-digital","version":"${version}"}
EOF
  printf '{}\n' > "${TEST_ROOT}/opt/pulso-digital/releases/${release}/package-lock.json"
  printf '{"production":true}\n' > "${TEST_ROOT}/opt/pulso-digital/releases/${release}/content/articles.json"
  printf 'asset\n' > "${TEST_ROOT}/opt/pulso-digital/releases/${release}/public/asset.txt"
  touch "${TEST_ROOT}/opt/pulso-digital/releases/${release}/tools/verify-safe-state.mjs"
  touch "${TEST_ROOT}/opt/pulso-digital/releases/${release}/tools/verify-expected-state.mjs"
done
install -d "${TEST_ROOT}/opt/pulso-digital/releases/current/src/storage"
touch "${TEST_ROOT}/opt/pulso-digital/releases/current/src/storage/cli.mjs"

for release in current target; do
  git -C "${TEST_ROOT}/opt/pulso-digital/releases/${release}" init -q
  git -C "${TEST_ROOT}/opt/pulso-digital/releases/${release}" add .
  git -C "${TEST_ROOT}/opt/pulso-digital/releases/${release}" \
    -c user.name=PulsoTest -c user.email=pulso@example.invalid \
    commit -qm "${release}"
done
target_commit=$(git -C "${TEST_ROOT}/opt/pulso-digital/releases/target" rev-parse HEAD)
ln -s "${TEST_ROOT}/opt/pulso-digital/releases/current" "${TEST_ROOT}/opt/pulso-digital/current"

cat > "${TEST_ROOT}/etc/pulso-digital/pulso.env" <<EOF
PULSO_STORAGE_KEY=test
PULSO_DATA_ROOT=${TEST_ROOT}/var/lib/pulso-digital
PULSO_PYTHON_BIN=${TEST_ROOT}/opt/pulso-digital/venv/bin/python
EOF
chmod 0600 "${TEST_ROOT}/etc/pulso-digital/pulso.env"

output=$(
  /bin/bash "${REPO_ROOT}/deploy/scripts/96-switch-release.sh" \
    --release "${TEST_ROOT}/opt/pulso-digital/releases/target" \
    --commit "${target_commit}" \
    --dry-run
)
printf '%s\n' "${output}"
printf '%s\n' "${output}" | grep -q 'dry-run concluído'
[[ -L ${TEST_ROOT}/opt/pulso-digital/current ]]
[[ $(readlink "${TEST_ROOT}/opt/pulso-digital/current") == "${TEST_ROOT}/opt/pulso-digital/releases/current" ]]
printf 'UPDATE_DRY_RUN_SIMULATION_OK\n'
