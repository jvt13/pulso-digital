#!/bin/sh
set -eu

[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/pulsobit.tech" ] || exit 0

if output=$(nginx -t 2>&1); then
  logger -t pulsobit-certbot "certificate renewed; nginx configuration valid"
else
  printf '%s\n' "${output}" >&2
  logger -t pulsobit-certbot "certificate renewed but nginx -t failed"
  exit 1
fi

systemctl reload nginx
logger -t pulsobit-certbot "nginx reload completed after certificate renewal"
