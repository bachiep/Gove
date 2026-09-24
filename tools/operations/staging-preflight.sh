#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  tools/operations/staging-preflight.sh /absolute/path/to/staging.env [--osrm]

The command validates the local staging Compose configuration without starting
containers, contacting Cloudflare, or changing any external resource. The env
file is read by Docker Compose and is never printed. Pass --osrm only when the
external OSRM volume has already been prepared by an operator.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage 2>&1 || true
  exit 0
fi

env_file=${1:-}
with_osrm=false
if [[ "${2:-}" == "--osrm" ]]; then
  with_osrm=true
elif [[ -n "${2:-}" ]]; then
  echo "Unknown option: ${2}" >&2
  usage
  exit 64
fi

if [[ -z "$env_file" || "$env_file" != /* || ! -f "$env_file" ]]; then
  echo "First argument must be an existing absolute staging env-file path." >&2
  usage
  exit 64
fi

if [[ ! -r "$env_file" ]]; then
  echo "Staging env-file is not readable: $env_file" >&2
  exit 77
fi

env_mode=$(stat -c '%a' "$env_file")
if (( 8#$env_mode & 077 )); then
  echo "Refusing a staging env-file readable by group or others: $env_file" >&2
  echo "Use owner-only permissions, for example: chmod 600 '$env_file'" >&2
  exit 77
fi

for command in docker node stat; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command" >&2
    exit 69
  fi
done

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_directory/../.." && pwd)
compose_file="$repo_root/compose.staging.yaml"
if [[ ! -f "$compose_file" ]]; then
  echo "Staging Compose file is unavailable: $compose_file" >&2
  exit 69
fi

compose_args=(
  --env-file "$env_file"
  --file "$compose_file"
)
if [[ "$with_osrm" == true ]]; then
  compose_args+=(--profile osrm)
fi

compose_config_directory=$(mktemp -d)
compose_config_file="$compose_config_directory/config.json"
trap 'rm -f -- "$compose_config_file" && rmdir -- "$compose_config_directory"' EXIT
docker compose "${compose_args[@]}" config --format json --output "$compose_config_file"
compose_json=$(<"$compose_config_file")

validation_json=$(printf '%s' "$compose_json" | OSRM_PROFILE_ENABLED="$with_osrm" node -e "$(cat <<'NODE'
process.on('uncaughtException', (error) => {
  process.stderr.write(`Staging preflight failed: ${error.message}\n`);
  process.exit(1);
});

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const config = JSON.parse(input);
  const services = config.services ?? {};
  const requiredServices = ['postgres', 'migrate', 'api', 'web'];
  for (const service of requiredServices) {
    if (!services[service]) {
      throw new Error(`Missing required staging service: ${service}`);
    }
  }

  const postgresEnvironment = services.postgres.environment ?? {};
  const migrateEnvironment = services.migrate.environment ?? {};
  const apiEnvironment = services.api.environment ?? {};
  const requiredValues = [
    ['POSTGRES_PASSWORD', postgresEnvironment.POSTGRES_PASSWORD],
    ['AUTH_JWT_SECRET', apiEnvironment.AUTH_JWT_SECRET],
    ['AUTH_REFRESH_PEPPER', apiEnvironment.AUTH_REFRESH_PEPPER],
    ['WEB_ORIGIN', apiEnvironment.WEB_ORIGIN],
    ['DATABASE_URL', apiEnvironment.DATABASE_URL],
  ];

  for (const [name, value] of requiredValues) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing resolved staging value: ${name}`);
    }
  }

  for (const [name, value] of [
    ['AUTH_JWT_SECRET', apiEnvironment.AUTH_JWT_SECRET],
    ['AUTH_REFRESH_PEPPER', apiEnvironment.AUTH_REFRESH_PEPPER],
  ]) {
    if (value.length < 32) {
      throw new Error(`${name} must contain at least 32 characters`);
    }
    if (/gove-local-development|change-before-production|changeme/i.test(value)) {
      throw new Error(`${name} still contains a development placeholder`);
    }
  }

  if (String(postgresEnvironment.POSTGRES_PASSWORD).length < 16) {
    throw new Error('POSTGRES_PASSWORD must contain at least 16 characters');
  }
  if (postgresEnvironment.POSTGRES_PASSWORD === 'gove_local_only') {
    throw new Error('POSTGRES_PASSWORD still uses the local-only default');
  }
  if (apiEnvironment.NODE_ENV !== 'production') {
    throw new Error('Staging API must resolve NODE_ENV=production');
  }

  const osrmEnabled = process.env.OSRM_PROFILE_ENABLED === 'true';
  const osrmService = services.osrm;
  const routingBaseUrl = apiEnvironment.ROUTING_OSRM_BASE_URL;
  if (osrmEnabled) {
    if (!osrmService) {
      throw new Error('The OSRM profile did not resolve an osrm service');
    }
    if (typeof routingBaseUrl !== 'string' || routingBaseUrl.length === 0) {
      throw new Error(
        'ROUTING_OSRM_BASE_URL must be set when the OSRM profile is enabled',
      );
    }

    let routingUrl;
    try {
      routingUrl = new URL(routingBaseUrl);
    } catch {
      throw new Error('ROUTING_OSRM_BASE_URL must be a valid URL');
    }
    if (
      routingUrl.protocol !== 'http:' ||
      routingUrl.hostname !== 'osrm' ||
      (routingUrl.port !== '' && routingUrl.port !== '5000') ||
      routingUrl.username ||
      routingUrl.password ||
      routingUrl.search ||
      routingUrl.hash
    ) {
      throw new Error(
        'Staging OSRM must stay on the private http://osrm:5000 service address',
      );
    }

    if ((osrmService.ports ?? []).length !== 0) {
      throw new Error('Staging OSRM must not publish a host port');
    }
    const osrmVolume = osrmService.volumes?.find(
      (volume) => volume.target === '/data',
    );
    if (!osrmVolume || osrmVolume.read_only !== true) {
      throw new Error('Staging OSRM must use a read-only /data volume');
    }
    const declaredVolume = config.volumes?.[osrmVolume.source];
    if (!declaredVolume?.external) {
      throw new Error('Staging OSRM data volume must be external');
    }

    const command = osrmService.command ?? [];
    if (!command.includes('osrm-routed') || !command.includes('--algorithm')) {
      throw new Error('Staging OSRM must run osrm-routed with an explicit algorithm');
    }
  } else if (typeof routingBaseUrl === 'string' && routingBaseUrl.length > 0) {
    throw new Error(
      'ROUTING_OSRM_BASE_URL is set; rerun this preflight with --osrm or unset it for fallback mode',
    );
  }

  let webOrigin;
  try {
    webOrigin = new URL(apiEnvironment.WEB_ORIGIN);
  } catch {
    throw new Error('WEB_ORIGIN must be a valid URL');
  }
  if (webOrigin.protocol !== 'https:') {
    throw new Error('WEB_ORIGIN must use HTTPS for staging');
  }

  if (services.migrate.environment?.AUTH_JWT_SECRET !== apiEnvironment.AUTH_JWT_SECRET) {
    throw new Error('migrate and api AUTH_JWT_SECRET values differ');
  }
  if (services.migrate.environment?.AUTH_REFRESH_PEPPER !== apiEnvironment.AUTH_REFRESH_PEPPER) {
    throw new Error('migrate and api AUTH_REFRESH_PEPPER values differ');
  }

  const postgresPorts = services.postgres.ports ?? [];
  if (postgresPorts.length !== 0) {
    throw new Error('Staging PostgreSQL must not publish a host port');
  }
  const webPorts = services.web.ports ?? [];
  for (const port of webPorts) {
    if (port.host_ip !== '127.0.0.1') {
      throw new Error('Staging web must bind only to 127.0.0.1 for tunnel ingress');
    }
  }

  process.stdout.write(
    JSON.stringify({
      message: osrmEnabled
        ? 'Staging preflight passed: Compose, secret policy, HTTPS origin, local-only ingress, and private OSRM profile checks are valid.'
        : 'Staging preflight passed: Compose, secret policy, HTTPS origin, and local-only ingress checks are valid; routing remains on coordinate fallback.',
      osrmVolumeName: osrmEnabled
        ? config.volumes?.[services.osrm.volumes.find((volume) => volume.target === '/data').source]?.name
        : null,
    }),
  );
});

process.stdin.on('error', (error) => {
  throw error;
});
NODE
)")

message=$(printf '%s' "$validation_json" | node -e "
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => process.stdout.write(JSON.parse(input).message));
")
printf '%s\n' "$message"

if [[ "$with_osrm" == true ]]; then
  osrm_volume_name=$(printf '%s' "$validation_json" | node -e "
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const value = JSON.parse(input).osrmVolumeName;
  if (typeof value !== 'string' || value.length === 0) process.exit(1);
  process.stdout.write(value);
});
")
  if ! docker volume inspect "$osrm_volume_name" >/dev/null 2>&1; then
    echo "OSRM data volume does not exist: $osrm_volume_name" >&2
    echo "Create and populate it outside the repository before enabling the profile." >&2
    exit 69
  fi
  echo "OSRM external data volume exists: $osrm_volume_name"
fi
