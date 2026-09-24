#!/usr/bin/env bash
set -euo pipefail

target_database=${1:-}

if [[ -z "$target_database" || ! "$target_database" =~ ^gove_replay_[a-z0-9_]+$ ]]; then
  echo "Usage: GOVE_MIGRATION_REPLAY_CONFIRM=CREATE_NEW_DATABASE $0 gove_replay_<name>" >&2
  exit 64
fi

if [[ "${GOVE_MIGRATION_REPLAY_CONFIRM:-}" != "CREATE_NEW_DATABASE" ]]; then
  echo "Set GOVE_MIGRATION_REPLAY_CONFIRM=CREATE_NEW_DATABASE to create a new replay database." >&2
  exit 77
fi

database_user=${POSTGRES_USER:-gove}
database_url=${DATABASE_URL:-postgresql://gove:gove_local_only@127.0.0.1:${POSTGRES_PORT:-55432}/gove}

if docker compose exec -T postgres psql \
  --username "$database_user" \
  --dbname postgres \
  --tuples-only \
  --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$target_database'" \
  | grep -q '^1$'; then
  echo "Replay database already exists: $target_database" >&2
  echo "Choose a new gove_replay_* name; this script never drops replay databases." >&2
  exit 73
fi

docker compose exec -T postgres createdb \
  --username "$database_user" \
  "$target_database"

replay_database_url=$(node - "$database_url" "$target_database" <<'NODE'
const [databaseUrl, targetDatabase] = process.argv.slice(2);
const url = new URL(databaseUrl);
url.pathname = `/${targetDatabase}`;
process.stdout.write(url.toString());
NODE
)

DATABASE_URL="$replay_database_url" NODE_ENV=development npm run db:migrate

expected_versions=$(find infra/postgres/migrations -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/[0-9]{4}-.+\.sql' \
  -printf '%f\n' | sort)
actual_versions=$(docker compose exec -T postgres psql \
  --username "$database_user" \
  --dbname "$target_database" \
  --tuples-only \
  --no-align \
  --command 'SELECT version FROM public.schema_migrations ORDER BY version' \
  | tr -d '\r')

if [[ "$actual_versions" != "$expected_versions" ]]; then
  echo "Migration registry does not match the repository migration set." >&2
  echo "Expected:" >&2
  printf '%s\n' "$expected_versions" >&2
  echo "Actual:" >&2
  printf '%s\n' "$actual_versions" >&2
  exit 1
fi

schema_count=$(docker compose exec -T postgres psql \
  --username "$database_user" \
  --dbname "$target_database" \
  --tuples-only \
  --no-align \
  --command "SELECT count(*) FROM information_schema.schemata WHERE schema_name IN ('identity', 'driver', 'location', 'pricing', 'trip', 'dispatch', 'payment', 'notification', 'delivery', 'audit')" \
  | tr -d '\r[:space:]')

if [[ "$schema_count" != "10" ]]; then
  echo "Expected ten application schemas, found $schema_count." >&2
  exit 1
fi

echo "Migration replay verified in new database: $target_database"
echo "Applied versions: $(wc -l <<< "$actual_versions" | tr -d ' ')"
echo "Application schemas verified: $schema_count"
