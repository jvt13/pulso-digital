#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

log "diagnóstico iniciado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '\n== Sistema ==\n'
cat /etc/os-release
uname -srm
hostnamectl 2>/dev/null || true

printf '\n== Recursos ==\n'
nproc
free -h
df -h /

printf '\n== Portas ==\n'
if command -v ss >/dev/null 2>&1; then
  ss -lntup || true
else
  log "comando ss indisponível"
fi

printf '\n== Serviços ativos ==\n'
systemctl list-units --type=service --state=running --no-pager 2>/dev/null || true

printf '\n== PM2 ==\n'
if command -v pm2 >/dev/null 2>&1; then
  pm2 list --no-color || true
else
  log "PM2 não encontrado no PATH"
fi

printf '\n== Nginx ==\n'
if command -v nginx >/dev/null 2>&1; then
  nginx -v 2>&1
  if ! nginx -t; then
    log "nginx -t falhou; diagnóstico continua sem reload"
  fi
  find /etc/nginx/sites-enabled -maxdepth 1 -type l -printf '%f -> %l\n' 2>/dev/null | sort || true
else
  log "Nginx não encontrado"
fi

printf '\n== Runtimes ==\n'
command -v node >/dev/null 2>&1 && node --version || true
command -v npm >/dev/null 2>&1 && npm --version || true
command -v python3.12 >/dev/null 2>&1 && python3.12 --version || true
command -v git >/dev/null 2>&1 && git --version || true

printf '\n== Certificados ==\n'
if command -v certbot >/dev/null 2>&1; then
  certbot certificates 2>/dev/null || true
else
  log "Certbot não encontrado"
fi

printf '\n== Firewall (somente leitura) ==\n'
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  log "UFW não encontrado"
fi

printf '\n== Caminhos do PulsoBit ==\n'
for path in "${APP_ROOT}" "${STATE_ROOT}" "${CONFIG_ROOT}" "${WEB_ROOT}"; do
  if [[ -e ${path} ]]; then
    stat -c '%n %F %U:%G %a' "${path}"
  else
    printf '%s ausente\n' "${path}"
  fi
done

log "diagnóstico concluído sem alterações"
