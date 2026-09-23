const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const mode = process.env.LOAD_MODE ?? 'health';
const concurrency = positiveInteger(process.env.LOAD_CONCURRENCY, 4);
const durationSeconds = positiveInteger(process.env.LOAD_DURATION_SECONDS, 10);
const intervalMs = nonNegativeInteger(process.env.LOAD_INTERVAL_MS, 0);
const tokens = (process.env.LOAD_AUTH_TOKENS ?? '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);

if (mode === 'location' && tokens.length === 0) {
  throw new Error(
    'LOAD_AUTH_TOKENS must contain comma-separated Driver access tokens for location mode',
  );
}

const targetPath =
  mode === 'health'
    ? '/api/v1/health/live'
    : mode === 'location'
      ? '/api/v1/drivers/me/location'
      : (process.env.LOAD_PATH ?? '/api/v1/health/live');
const method = mode === 'location' ? 'PUT' : (process.env.LOAD_METHOD ?? 'GET');
const deadline = Date.now() + durationSeconds * 1_000;
const sequenceByToken = new Map();
const samples = [];
const statusCounts = new Map();

async function worker(workerId) {
  while (Date.now() < deadline) {
    const startedAt = process.hrtime.bigint();
    const token = tokens[workerId % tokens.length];
    const response = await fetch(`${baseUrl}${targetPath}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(mode === 'location' ? { 'content-type': 'application/json' } : {}),
      },
      ...(mode === 'location'
        ? { body: JSON.stringify(locationPayload(token, workerId)) }
        : {}),
    }).catch(() => null);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    samples.push(elapsedMs);
    const status = response?.status ?? 0;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    if (intervalMs > 0) await delay(intervalMs);
  }
}

await Promise.all(
  Array.from({ length: concurrency }, (_, workerId) => worker(workerId)),
);

const sorted = samples.toSorted((left, right) => left - right);
const result = {
  mode,
  baseUrl,
  targetPath,
  method,
  concurrency,
  durationSeconds,
  intervalMs,
  requests: samples.length,
  requestsPerSecond: round(samples.length / durationSeconds),
  latencyMs: {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: round(sorted.at(-1) ?? 0),
  },
  statusCounts: Object.fromEntries(statusCounts),
};

console.log(JSON.stringify(result, null, 2));

function locationPayload(token, workerId) {
  const sequenceNumber = (sequenceByToken.get(token) ?? 0) + 1;
  sequenceByToken.set(token, sequenceNumber);
  return {
    latitude: 10.76 + ((workerId + sequenceNumber) % 100) / 100_000,
    longitude: 106.68 + ((workerId + sequenceNumber) % 100) / 100_000,
    accuracyMeters: 10,
    source: 'SIMULATOR',
    sequenceNumber,
  };
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  return round(
    values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)],
  );
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer load setting');
  }
  return parsed;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Expected a non-negative integer load setting');
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
