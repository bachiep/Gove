#!/usr/bin/env bash
set -euo pipefail

backup_directory=${1:-}
if [[ -z "$backup_directory" || "$backup_directory" != /* ]]; then
  echo "Usage: $0 /absolute/backup-directory" >&2
  exit 64
fi

mkdir -p "$backup_directory"
if [[ ! -d "$backup_directory" ]]; then
  echo "Backup directory is unavailable: $backup_directory" >&2
  exit 73
fi

umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$backup_directory/gove-${timestamp}.dump"

docker compose exec -T postgres pg_dump \
  --username "${POSTGRES_USER:-gove}" \
  --dbname "${POSTGRES_DB:-gove}" \
  --format=custom > "$output"
chmod 600 "$output"
if [[ "$(stat -c '%a' "$output")" != "600" ]]; then
  echo "Backup filesystem did not enforce owner-only permissions: $output" >&2
  exit 73
fi

echo "Created PostgreSQL backup: $output"
