#!/usr/bin/env bash
set -euo pipefail

# This rehearsal deliberately uses a generated Compose project and database
# volume. It never points an application at the development database and never
# removes a resource that was not created by this invocation.

usage() {
  cat >&2 <<'USAGE'
Usage:
  GOVE_ROLLBACK_CONFIRM=LOCAL_ROLLBACK_REHEARSAL \
    tools/operations/rollback-rehearsal.sh <previous-git-ref>

The current working tree is built as the candidate image. <previous-git-ref>
must resolve to a local Git commit or tag and is built as the rollback image.
The rehearsal creates only a uniquely named local Compose project and volume,
then removes those generated resources after a successful run.

Optional:
  GOVE_ROLLBACK_KEEP_RESOURCES=1  Keep the generated project/volume on success
  GOVE_ROLLBACK_KEEP_IMAGES=1     Keep the two generated local Docker images
USAGE
}

if [[ "${GOVE_ROLLBACK_CONFIRM:-}" != "LOCAL_ROLLBACK_REHEARSAL" ]]; then
  echo "Set GOVE_ROLLBACK_CONFIRM=LOCAL_ROLLBACK_REHEARSAL to run this local rehearsal." >&2
  usage
  exit 77
fi

previous_ref=${1:-}
if [[ -z "$previous_ref" ]]; then
  usage
  exit 64
fi

for command in docker git node tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command" >&2
    exit 69
  fi
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
previous_commit=$(git rev-parse --verify "${previous_ref}^{commit}")

run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}
run_id=${run_id,,}
project="gove_rollback_${run_id//[^a-zA-Z0-9_]/_}"
candidate_image="gove-rollback-${run_id}-candidate:local"
previous_image="gove-rollback-${run_id}-previous:local"
work_directory=$(mktemp -d "${TMPDIR:-/tmp}/gove-rollback.XXXXXX")
previous_source="$work_directory/previous-source"
compose_file="$work_directory/compose.yaml"
compose_env="$work_directory/compose.env"
mkdir -p "$previous_source"

cleanup_project() {
  if [[ "${GOVE_ROLLBACK_KEEP_RESOURCES:-0}" == "1" ]]; then
    echo "Keeping generated local resources for inspection: $project"
    return
  fi

  # The project name is generated above and does not come from a broad path or
  # a user-supplied wildcard. This is the only cleanup this script performs.
  "${compose_command[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}

cleanup_images() {
  if [[ "${GOVE_ROLLBACK_KEEP_IMAGES:-0}" == "1" ]]; then
    echo "Keeping generated local images: $candidate_image $previous_image"
    return
  fi
  docker image rm "$candidate_image" "$previous_image" >/dev/null 2>&1 || true
}

cleanup_work_directory() {
  local temporary_root=${TMPDIR:-/tmp}
  case "$work_directory" in
    "$temporary_root"/gove-rollback.*)
      rm -rf -- "$work_directory"
      ;;
    *)
      echo "Refusing to remove an unexpected rollback work directory: $work_directory" >&2
      return 1
      ;;
  esac
}

on_exit() {
  status=$?
  if [[ "$status" -eq 0 ]]; then
    cleanup_project
    cleanup_images
    cleanup_work_directory
  else
    echo "Rollback rehearsal failed; generated resources were kept for inspection." >&2
    echo "Compose project: $project" >&2
    echo "Compose file: $compose_file" >&2
    echo "Cleanup command (only this generated project):" >&2
    echo "docker compose --project-name '$project' --file '$compose_file' --env-file '$compose_env' down --volumes --remove-orphans" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

compose_command=(docker compose --project-name "$project" --env-file "$compose_env" --file "$compose_file")

cat > "$compose_file" <<'COMPOSE'
name: gove-rollback-rehearsal

services:
  postgres:
    image: postgis/postgis:17-3.5-alpine
    environment:
      POSTGRES_DB: gove
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_USER: gove
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 2s
      timeout: 3s
      retries: 20
      start_period: 3s
    volumes:
      - rollback-postgres:/var/lib/postgresql/data

  migrate:
    image: ${GOVE_APP_IMAGE}
    command: ['node', 'apps/api/dist/database/migrate.js']
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://gove:${POSTGRES_PASSWORD}@postgres:5432/gove
      NODE_ENV: production
      WEB_ORIGIN: http://rollback.invalid
      AUTH_JWT_SECRET: rollback-local-jwt-secret-012345678901234567890123
      AUTH_REFRESH_PEPPER: rollback-local-refresh-pepper-012345678901234567890123
    restart: 'no'

  api:
    image: ${GOVE_APP_IMAGE}
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      API_HOST: 0.0.0.0
      API_PORT: 3000
      DATABASE_URL: postgresql://gove:${POSTGRES_PASSWORD}@postgres:5432/gove
      NODE_ENV: production
      WEB_ORIGIN: http://rollback.invalid
      AUTH_JWT_SECRET: rollback-local-jwt-secret-012345678901234567890123
      AUTH_REFRESH_PEPPER: rollback-local-refresh-pepper-012345678901234567890123
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3000/api/v1/health/live').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))",
        ]
      interval: 2s
      timeout: 3s
      retries: 20
      start_period: 5s

volumes:
  rollback-postgres:
COMPOSE

rollback_password="rollback_${run_id//[^a-zA-Z0-9]/}"
cat > "$compose_env" <<ENV
GOVE_APP_IMAGE=$candidate_image
POSTGRES_PASSWORD=$rollback_password
ENV

echo "Building candidate image from the current working tree: $candidate_image"
docker build --pull=false \
  --file "$repo_root/infra/docker/api.Dockerfile" \
  --tag "$candidate_image" "$repo_root"

echo "Archiving previous Git ref $previous_ref ($previous_commit)"
git archive "$previous_commit" | tar -x -C "$previous_source"
echo "Building rollback image from $previous_commit: $previous_image"
docker build --pull=false \
  --file "$previous_source/infra/docker/api.Dockerfile" \
  --tag "$previous_image" "$previous_source"

echo "Starting isolated rollback rehearsal project: $project"
"${compose_command[@]}" up -d --wait postgres

wait_for_database() {
  local attempts=30
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "${compose_command[@]}" exec -T postgres psql \
      --username gove \
      --dbname gove \
      --command 'SELECT 1' >/dev/null 2>&1; then
      echo "Rollback rehearsal database accepted connections after attempt $attempt"
      return 0
    fi
    sleep 1
  done
  echo "Rollback rehearsal database did not accept connections within ${attempts}s" >&2
  return 1
}

wait_for_database

health_check() {
  local label=$1
  local status
  status=$("${compose_command[@]}" exec -T api node -e \
    "fetch('http://127.0.0.1:3000/api/v1/health/live').then(async (response) => { if (!response.ok) process.exit(1); process.stdout.write(String(response.status)); }).catch(() => process.exit(1))")
  echo "$label health: $status"
}

run_migrations() {
  local attempt
  for attempt in {1..10}; do
    if "${compose_command[@]}" run --rm migrate; then
      return 0
    fi
    if [[ "$attempt" -lt 10 ]]; then
      echo "Migration runner was not ready; retrying ($attempt/10)" >&2
      sleep 1
    fi
  done
  return 1
}

echo "Applying the candidate migration set to the fresh rehearsal database"
run_migrations
"${compose_command[@]}" up -d --wait api

health_check candidate

sentinel_email="rollback-${run_id}@example.invalid"
echo "Creating one synthetic sentinel record before application rollback"
"${compose_command[@]}" exec -T postgres psql \
  --username gove \
  --dbname gove \
  --command "INSERT INTO identity.users (id, email, display_name) VALUES (gen_random_uuid(), '$sentinel_email', 'Rollback rehearsal sentinel');"

expected_migration_count=$(find infra/postgres/migrations -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/[0-9]{4}-.+\.sql' | wc -l | tr -d '[:space:]')
actual_migration_count=$("${compose_command[@]}" exec -T postgres psql \
  --username gove --dbname gove --tuples-only --no-align \
  --command 'SELECT count(*) FROM public.schema_migrations' | tr -d '[:space:]')
if [[ "$actual_migration_count" != "$expected_migration_count" ]]; then
  echo "Candidate migration count mismatch: expected $expected_migration_count, got $actual_migration_count" >&2
  exit 1
fi

echo "Switching the isolated API service to the previous image without changing the database volume"
cat > "$compose_env" <<ENV
GOVE_APP_IMAGE=$previous_image
POSTGRES_PASSWORD=$rollback_password
ENV
"${compose_command[@]}" up -d --no-deps --force-recreate --wait api
health_check rollback

echo "Running the previous image's migration runner against the forward-compatible schema"
run_migrations

sentinel_count=$("${compose_command[@]}" exec -T postgres psql \
  --username gove --dbname gove --tuples-only --no-align \
  --command "SELECT count(*) FROM identity.users WHERE email = '$sentinel_email'" \
  | tr -d '[:space:]')
if [[ "$sentinel_count" != "1" ]]; then
  echo "Rollback data-preservation check failed: sentinel count=$sentinel_count" >&2
  exit 1
fi

post_rollback_migration_count=$("${compose_command[@]}" exec -T postgres psql \
  --username gove --dbname gove --tuples-only --no-align \
  --command 'SELECT count(*) FROM public.schema_migrations' | tr -d '[:space:]')
if [[ "$post_rollback_migration_count" != "$expected_migration_count" ]]; then
  echo "Rollback migration registry changed unexpectedly: expected $expected_migration_count, got $post_rollback_migration_count" >&2
  exit 1
fi

echo "Rollback rehearsal passed"
echo "Candidate image: $candidate_image"
echo "Rollback image: $previous_image ($previous_commit)"
echo "Migration versions preserved: $post_rollback_migration_count"
echo "Synthetic sentinel preserved: $sentinel_email"
echo "No development database, external host, or broad Docker resource was touched"
