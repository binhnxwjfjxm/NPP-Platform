#!/usr/bin/env bash
set -euo pipefail

if command -v pg_dump >/dev/null 2>&1 && pg_dump --version | grep -Eq ' 17([.]|$)'; then
  pg_dump --version
  pg_restore --version
  exit 0
fi

sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null

. /etc/os-release
if [[ -z "${VERSION_CODENAME:-}" ]]; then
  echo 'Unable to determine Ubuntu codename for PostgreSQL client installation' >&2
  exit 1
fi

echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-client-17

pg_dump --version | grep -Eq ' 17([.]|$)'
pg_restore --version | grep -Eq ' 17([.]|$)'
pg_dump --version
pg_restore --version
