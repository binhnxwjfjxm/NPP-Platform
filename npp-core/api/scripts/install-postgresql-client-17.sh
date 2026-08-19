#!/usr/bin/env bash
set -euo pipefail

PG17_BIN=/usr/lib/postgresql/17/bin
NETWORK_TIMEOUT_SECONDS=90
APT_TIMEOUT_SECONDS=240

if [[ -x "${PG17_BIN}/pg_dump" && -x "${PG17_BIN}/pg_restore" ]]; then
  "${PG17_BIN}/pg_dump" --version | grep -Eq ' 17([.]|$)'
  "${PG17_BIN}/pg_restore" --version | grep -Eq ' 17([.]|$)'
  "${PG17_BIN}/pg_dump" --version
  "${PG17_BIN}/pg_restore" --version
  exit 0
fi

sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
echo 'Downloading the PostgreSQL repository signing key'
timeout --foreground --kill-after=15s "${NETWORK_TIMEOUT_SECONDS}s" \
  curl --fail --silent --show-error \
  --connect-timeout 15 \
  --max-time 60 \
  --retry 3 \
  --retry-delay 2 \
  --retry-all-errors \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null

. /etc/os-release
if [[ -z "${VERSION_CODENAME:-}" ]]; then
  echo 'Unable to determine Ubuntu codename for PostgreSQL client installation' >&2
  exit 1
fi

echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null

echo 'Refreshing the PostgreSQL package index'
sudo timeout --foreground --kill-after=15s "${APT_TIMEOUT_SECONDS}s" \
  apt-get \
  -o Dir::Etc::sourcelist='sources.list.d/pgdg.list' \
  -o Dir::Etc::sourceparts='-' \
  -o APT::Get::List-Cleanup='0' \
  -o Acquire::Retries=3 \
  -o Acquire::http::Timeout=30 \
  -o Acquire::https::Timeout=30 \
  update -qq

echo 'Installing PostgreSQL 17 client tools'
sudo env DEBIAN_FRONTEND=noninteractive \
  timeout --foreground --kill-after=15s "${APT_TIMEOUT_SECONDS}s" \
  apt-get \
  -o Acquire::Retries=3 \
  -o Acquire::http::Timeout=30 \
  -o Acquire::https::Timeout=30 \
  install -y --no-install-recommends postgresql-client-17

[[ -x "${PG17_BIN}/pg_dump" && -x "${PG17_BIN}/pg_restore" ]]
"${PG17_BIN}/pg_dump" --version | grep -Eq ' 17([.]|$)'
"${PG17_BIN}/pg_restore" --version | grep -Eq ' 17([.]|$)'
"${PG17_BIN}/pg_dump" --version
"${PG17_BIN}/pg_restore" --version
