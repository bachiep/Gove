# Optional OSRM staging seam

Status: Configuration implemented; runtime requires an operator-supplied data
volume

Last updated: 2026-09-25

This repository contains only the bounded OSRM integration seam. It does not
contain an OpenStreetMap extract, download one, or publish an OSRM endpoint.
The extract and generated OSRM files must be prepared by an operator outside
the repository and placed in a Docker volume declared as `external: true`.

## Default behavior

Leave `ROUTING_OSRM_BASE_URL` unset. The API then selects the deterministic
`coordinate-fallback` provider and labels the result as an estimate. The
`osrm` Compose service belongs to the opt-in `osrm` profile and is not started
by the normal local or staging commands.

An empty `ROUTING_OSRM_BASE_URL` value in a Compose env file is treated as
unset. This makes the staging file safe to use in fallback mode without
inventing a provider-backed route.

## Data contract

The external volume must contain the generated OSRM dataset base named by
`OSRM_DATASET` (default `hanoi-latest`). For the default `mld` algorithm, the
volume must contain the complete generated file set, for example:

```text
hanoi-latest.osrm
hanoi-latest.osrm.properties
hanoi-latest.osrm.partition
hanoi-latest.osrm.cells
...
```

The exact files depend on the OSRM version and preprocessing pipeline. Keep
the source extract, license/attribution record, checksum, preparation date,
OSRM image tag, and profile outside Git and record their non-secret release
metadata in deployment evidence.

## Local opt-in profile

The local Compose file binds OSRM only to loopback port `5500` and uses an
external Docker volume. The API itself is normally run on the host, so its
base URL points at that loopback port:

```text
OSRM_VOLUME_NAME=gove-osrm-data
OSRM_DATASET=hanoi-latest
OSRM_ALGORITHM=mld
OSRM_PORT=5500
ROUTING_OSRM_BASE_URL=http://127.0.0.1:5500/
```

Create and populate `gove-osrm-data` outside this repository, then start only
the optional service:

```bash
docker volume create gove-osrm-data
docker compose --profile osrm up -d osrm
```

The command above does not populate the volume. Do not use a public OSRM demo
server as a substitute for this local seam. If the volume is absent or the
service is unhealthy, remove the URL from the local env and continue with the
coordinate fallback.

## Staging opt-in profile

Staging keeps OSRM on the private Compose network. It has no `ports` mapping,
and the API reaches it only through the service name:

```text
OSRM_VOLUME_NAME=gove-staging-osrm-data
OSRM_DATASET=hanoi-latest
OSRM_ALGORITHM=mld
ROUTING_OSRM_BASE_URL=http://osrm:5000/
```

After the external volume has been prepared, validate without starting any
container:

```bash
tools/operations/staging-preflight.sh /secure/path/gove.env --osrm
```

The `--osrm` preflight checks the private URL, read-only external volume,
explicit `osrm-routed` command, absence of a host OSRM port, and existence of
the named Docker volume. It never downloads data or changes the volume.

Start staging with the opt-in profile only after that check passes:

```bash
docker compose --env-file /secure/path/gove.env \
  --profile osrm -f compose.staging.yaml up --build -d
```

The OSRM healthcheck verifies that the configured generated dataset metadata
file is readable and that the `osrm-routed` process is alive. It is not a
claim that a real Hanoi route has been measured. Retain a separate, sanitized
runtime probe as evidence, for example from the API container:

```bash
docker compose --env-file /secure/path/gove.env \
  -f compose.staging.yaml exec -T api node -e \
  "fetch('http://osrm:5000/route/v1/driving/105.82,21.03;105.83,21.04?overview=false').then(async r => { if (!r.ok) process.exit(1); const b = await r.json(); if (b.code !== 'Ok') process.exit(1); console.log('OSRM route probe passed'); }).catch(() => process.exit(1))"
```

This probe is optional evidence and must not be recorded as a benchmark. It
does not expose OSRM through Cloudflare, the PWA port, or a public DNS name.

## Safety boundaries

- Do not commit `.osm.pbf`, `.osrm*`, generated map tiles, or volume backups.
- Do not add OSRM to the default `docker compose up` path.
- Do not publish port `5000` in staging or pass an OSRM URL to the browser.
- Do not call a coordinate fallback a road route or traffic-aware ETA.
- Keep the OSRM image tag, dataset checksum, and resource measurements in
  deployment evidence before making road-routing claims.

The official OSRM Docker workflow uses `osrm-routed` against a preprocessed
dataset and recommends the MLD pipeline for the general case; this seam keeps
that data preparation explicitly outside the application repository.
