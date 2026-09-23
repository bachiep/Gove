#!/usr/bin/env bash
set -euo pipefail

backup_file=${1:-}
target_database=${2:-}

if [[ -z "$backup_file" || "$backup_file" != /* || ! -f "$backup_file" ]]; then
  echo "First argument must be an existing absolute backup path." >&2
  exit 64
fi
if [[ ! "$target_database" =~ ^gove_restore_[a-z0-9_]+$ ]]; then
  echo "Target database must match gove_restore_[a-z0-9_]+." >&2
  exit 64
fi
if [[ "${GOVE_RESTORE_CONFIRM:-}" != "RESTORE_TO_NEW_DATABASE" ]]; then
  echo "Set GOVE_RESTORE_CONFIRM=RESTORE_TO_NEW_DATABASE to continue." >&2
  exit 77
fi

container_path="/tmp/$(basename "$backup_file")"
docker compose exec -T postgres psql \
  --username "${POSTGRES_USER:-gove}" \
  --dbname postgres \
  --tuples-only \
  --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$target_database'" \
  | grep -q '^1$' && {
  echo "Target database already exists: $target_database" >&2
  exit 73
}

docker compose exec -T postgres createdb \
  --username "${POSTGRES_USER:-gove}" \
  "$target_database"
docker compose cp "$backup_file" "postgres:$container_path"
docker compose exec -T postgres pg_restore \
  --username "${POSTGRES_USER:-gove}" \
  --dbname "$target_database" \
  --exit-on-error \
  "$container_path"

echo "Restored into new database: $target_database"
