import { randomUUID } from 'node:crypto';

const mode = process.env.LOAD_MODE ?? 'health';
const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const allowExternalUrl = readBoolean('LOAD_ALLOW_EXTERNAL_URL', false);
assertSafeBaseUrl(baseUrl, allowExternalUrl);

const maxConcurrency = mode === 'closed-loop' ? 12 : 32;
const concurrency = positiveInteger(
  process.env.LOAD_CONCURRENCY,
  4,
  maxConcurrency,
  'LOAD_CONCURRENCY',
);
const durationSeconds = positiveInteger(
  process.env.LOAD_DURATION_SECONDS,
  10,
  300,
  'LOAD_DURATION_SECONDS',
);
const intervalMs = nonNegativeInteger(
  process.env.LOAD_INTERVAL_MS,
  0,
  60_000,
  'LOAD_INTERVAL_MS',
);
const requestTimeoutMs = positiveInteger(
  process.env.LOAD_REQUEST_TIMEOUT_MS,
  10_000,
  30_000,
  'LOAD_REQUEST_TIMEOUT_MS',
);
const dryRun = readBoolean('LOAD_DRY_RUN', false);
const smoke = readBoolean('LOAD_SMOKE', false);

// Synthetic coordinates for the current Hanoi demo service area.
// Keep these inside the bounded Hanoi box: 20.98–21.10 latitude,
// 105.76–105.90 longitude.
const hanoiDemoCoordinates = Object.freeze({
  driver: Object.freeze({ latitude: 21.0285, longitude: 105.8048 }),
  pickup: Object.freeze({ latitude: 21.0285, longitude: 105.8048 }),
  dropoff: Object.freeze({ latitude: 21.033, longitude: 105.835 }),
});

async function runSimpleMode() {
  const tokens = readTokens('LOAD_AUTH_TOKENS');
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
  const method =
    mode === 'location' ? 'PUT' : (process.env.LOAD_METHOD ?? 'GET');
  const recorder = new MetricsRecorder();
  const deadline = Date.now() + durationSeconds * 1_000;
  const sequenceByToken = new Map();

  async function worker(workerId) {
    while (Date.now() < deadline) {
      const token = tokens[workerId % Math.max(tokens.length, 1)];
      await issueRequest(recorder, {
        stage: mode,
        phase: 'measurement',
        method,
        path: targetPath,
        token,
        body:
          mode === 'location'
            ? locationPayload(
                sequenceByToken,
                token ?? `worker-${workerId}`,
                workerId,
              )
            : undefined,
      });
      if (intervalMs > 0) await delay(intervalMs);
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, workerId) => worker(workerId)),
  );

  const measured = recorder.summary('measurement');
  console.log(
    JSON.stringify(
      {
        mode,
        baseUrl,
        targetPath,
        method,
        concurrency,
        durationSeconds,
        intervalMs,
        requests: measured.requests,
        requestsPerSecond: round(measured.requests / durationSeconds),
        latencyMs: measured.latencyMs,
        statusCounts: measured.statusCounts,
        errorCounts: measured.errorCounts,
      },
      null,
      2,
    ),
  );
}

async function runClosedLoop() {
  const warmupSeconds = positiveInteger(
    process.env.LOAD_WARMUP_SECONDS,
    smoke ? 0 : 5,
    120,
    'LOAD_WARMUP_SECONDS',
    true,
  );
  const completeTrips = readBoolean('LOAD_COMPLETE_TRIPS', true);
  const operatorToken = process.env.LOAD_OPERATOR_TOKEN?.trim() || null;
  const suppliedDriverTokens = readTokens('LOAD_DRIVER_TOKENS');
  const runId = randomUUID();
  const recorder = new MetricsRecorder();
  const phaseSummaries = {
    warmup: new LifecycleSummary(completeTrips),
    measurement: new LifecycleSummary(completeTrips),
  };

  const configuration = {
    mode,
    baseUrl,
    concurrency: smoke ? 1 : concurrency,
    warmupSeconds,
    durationSeconds: smoke ? 1 : durationSeconds,
    intervalMs,
    requestTimeoutMs,
    completeTrips,
    dryRun,
    smoke,
    allowExternalUrl,
    accountSetup: {
      registersSyntheticCustomerAndDriver: true,
      operatorTokenProvided: Boolean(operatorToken),
      suppliedDriverTokens: suppliedDriverTokens.length,
    },
    safety: {
      externalUrlRequiresExplicitOptIn: true,
      maximumConcurrency: 12,
      maximumDurationSeconds: 300,
      credentialsStoredOnlyInMemory: true,
    },
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ...configuration,
          dryRun: true,
          plan: [
            'Register and login synthetic Customer and Driver accounts',
            'Create Driver profile and Vehicle',
            'Use LOAD_OPERATOR_TOKEN to approve the synthetic Driver and Vehicle when acceptance is required',
            'Set Driver location and availability',
            'Create Fare Quote and Trip, start matching, and accept an offer when a mapped Driver is available',
            completeTrips
              ? 'Complete accepted Trips through arrive, start, and complete transitions'
              : 'Stop the lifecycle after Driver acceptance',
          ],
          note: 'No network request was made.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const setup = {
    runId,
    syntheticAccounts: [],
    setupErrors: [],
    availableDrivers: [],
    notes: [],
  };
  const customers = [];
  const driverTokensById = new Map();
  const locationSequences = new Map();

  for (let workerId = 0; workerId < (smoke ? 1 : concurrency); workerId += 1) {
    const customer = await provisionAccount({
      role: 'CUSTOMER',
      workerId,
      runId,
      recorder,
    });
    const driver = await provisionAccount({
      role: 'DRIVER',
      workerId,
      runId,
      recorder,
    });
    setup.syntheticAccounts.push({
      workerId,
      customer: accountSummary(customer),
      driver: accountSummary(driver),
    });

    if (customer.token && customer.actorId) customers.push(customer);
    else setup.setupErrors.push(`customer-${workerId}-setup-failed`);

    if (driver.token && driver.actorId) {
      const prepared = await prepareSyntheticDriver({
        driver,
        workerId,
        recorder,
        operatorToken,
        locationSequences,
      });
      if (prepared.available) {
        driverTokensById.set(driver.actorId, driver.token);
        setup.availableDrivers.push({
          driverId: driver.actorId,
          source: 'synthetic',
        });
      } else if (prepared.reason) {
        setup.notes.push(`synthetic-driver-${workerId}: ${prepared.reason}`);
      }
    } else {
      setup.notes.push(`synthetic-driver-${workerId}: account-setup-failed`);
    }
  }

  for (const [index, token] of suppliedDriverTokens.entries()) {
    const prepared = await prepareSuppliedDriver({
      token,
      index,
      recorder,
      locationSequences,
    });
    if (prepared.available && prepared.actorId) {
      driverTokensById.set(prepared.actorId, token);
      setup.availableDrivers.push({
        driverId: prepared.actorId,
        source: 'supplied-token',
      });
    } else if (prepared.reason) {
      setup.notes.push(`supplied-driver-${index}: ${prepared.reason}`);
    }
  }

  if (operatorToken) {
    setup.notes.push(
      'The operator token was used only through documented Operator HTTP endpoints; no database state was written by the load tool.',
    );
  } else {
    setup.notes.push(
      'No LOAD_OPERATOR_TOKEN was provided; synthetic Drivers remain pending and cannot accept offers.',
    );
  }

  if (customers.length === 0) {
    console.log(
      JSON.stringify(
        {
          ...configuration,
          setup,
          error: 'No synthetic Customer account was ready for the workload.',
          requestStats: recorder.summary(),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  let currentPhase = 'setup';
  const heartbeatPromises = new Set();
  const heartbeat = setInterval(() => {
    for (const driver of setup.availableDrivers) {
      const token = driverTokensById.get(driver.driverId);
      if (!token) continue;
      const promise = refreshDriverLocation({
        token,
        driverId: driver.driverId,
        recorder,
        phase: currentPhase === 'warmup' ? 'warmup' : 'measurement',
        locationSequences,
      }).finally(() => heartbeatPromises.delete(promise));
      heartbeatPromises.add(promise);
    }
  }, 5_000);

  try {
    if (warmupSeconds > 0) {
      currentPhase = 'warmup';
      await runWorkloadPhase({
        customers,
        durationSeconds: warmupSeconds,
        phase: 'warmup',
        recorder,
        summaries: phaseSummaries,
        driverTokensById,
        completeTrips,
      });
    }

    currentPhase = 'measurement';
    const measuredStartedAt = Date.now();
    await runWorkloadPhase({
      customers,
      durationSeconds: smoke ? 1 : durationSeconds,
      phase: 'measurement',
      recorder,
      summaries: phaseSummaries,
      driverTokensById,
      completeTrips,
    });
    const measuredElapsedSeconds = Math.max(
      (Date.now() - measuredStartedAt) / 1_000,
      0.001,
    );

    await Promise.all(heartbeatPromises);
    const measuredRequests = recorder.summary('measurement');
    const measuredLifecycle = phaseSummaries.measurement.toJSON();
    console.log(
      JSON.stringify(
        {
          ...configuration,
          durationSeconds: smoke ? 1 : durationSeconds,
          actualMeasurementSeconds: round(measuredElapsedSeconds),
          setup,
          warmup: {
            configuredSeconds: warmupSeconds,
            requestStats: recorder.summary('warmup'),
            correctness: phaseSummaries.warmup.toJSON(),
          },
          workload: {
            requestStats: measuredRequests,
            throughput: {
              requestsPerSecond: round(
                measuredRequests.requests / measuredElapsedSeconds,
              ),
              lifecycleAttemptsPerSecond: round(
                measuredLifecycle.attempts / measuredElapsedSeconds,
              ),
            },
            correctness: measuredLifecycle,
          },
          errorSummary: {
            requestErrors: measuredRequests.errorCounts,
            lifecycleErrors: measuredLifecycle.errorCounts,
            invariantViolations: measuredLifecycle.invariantViolations,
          },
          limitation:
            'Results describe only this bounded workload against the configured URL and do not establish production capacity, SLA, or geographic routing accuracy.',
        },
        null,
        2,
      ),
    );
  } finally {
    clearInterval(heartbeat);
    await Promise.all(heartbeatPromises);
  }
}

async function provisionAccount({ role, workerId, runId, recorder }) {
  const password = `GoveLoad-${randomUUID()}-pass`;
  const email = `load-${runId}-${role.toLowerCase()}-${workerId}@example.test`;
  const displayName = `Gove Load ${role} ${workerId}`;
  const registration = await issueRequest(recorder, {
    stage: `${role.toLowerCase()}.register`,
    phase: 'setup',
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email,
      displayName,
      password,
      requestedRole: role,
    },
    idempotencyKey: `${runId}-${role.toLowerCase()}-register-${workerId}`,
  });
  if (registration.status !== 201) {
    return { role, email, actorId: null, token: null };
  }

  const login = await issueRequest(recorder, {
    stage: `${role.toLowerCase()}.login`,
    phase: 'setup',
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email, password },
  });
  const actorId = stringValue(login.body?.actor?.id);
  const token = stringValue(login.body?.accessToken);
  if (login.status !== 200 || !actorId || !token) {
    return { role, email, actorId: null, token: null };
  }
  return { role, email, actorId, token };
}

async function prepareSyntheticDriver({
  driver,
  workerId,
  recorder,
  operatorToken,
  locationSequences,
}) {
  const profile = await issueRequest(recorder, {
    stage: 'driver.profile',
    phase: 'setup',
    method: 'PUT',
    path: '/api/v1/drivers/me/profile',
    token: driver.token,
    body: { phone: `090${String(1000000 + workerId).slice(-7)}` },
  });
  if (profile.status !== 200)
    return { available: false, reason: 'profile-failed' };

  const vehicle = await issueRequest(recorder, {
    stage: 'driver.vehicle',
    phase: 'setup',
    method: 'POST',
    path: '/api/v1/drivers/me/vehicles',
    token: driver.token,
    body: {
      vehicleClass: 'MOTORBIKE',
      make: 'Gove',
      model: 'Load Simulator',
      modelYear: 2025,
      plate: `LOAD-${String(workerId).padStart(3, '0')}-${randomUUID().slice(0, 4)}`,
    },
  });
  const vehicleId = stringValue(vehicle.body?.id);
  if (vehicle.status !== 201 || !vehicleId) {
    return { available: false, reason: 'vehicle-failed' };
  }

  if (!operatorToken) {
    return {
      available: false,
      reason: 'operator-token-required-for-driver-approval',
    };
  }

  const approvalReason = `Load run ${workerId}`;
  const profileApproval = await issueRequest(recorder, {
    stage: 'operator.driver.approve',
    phase: 'setup',
    method: 'POST',
    path: `/api/v1/operator/drivers/${driver.actorId}/approve`,
    token: operatorToken,
    body: { reason: approvalReason },
  });
  if (profileApproval.status !== 201) {
    return { available: false, reason: 'driver-approval-failed' };
  }

  const vehicleApproval = await issueRequest(recorder, {
    stage: 'operator.vehicle.approve',
    phase: 'setup',
    method: 'POST',
    path: `/api/v1/operator/drivers/${driver.actorId}/vehicles/${vehicleId}/approve`,
    token: operatorToken,
    body: { reason: approvalReason },
  });
  if (vehicleApproval.status !== 201) {
    return { available: false, reason: 'vehicle-approval-failed' };
  }

  return prepareDriverAvailability({
    token: driver.token,
    driverId: driver.actorId,
    recorder,
    phase: 'setup',
    locationSequences,
  });
}

async function prepareSuppliedDriver({
  token,
  index,
  recorder,
  locationSequences,
}) {
  const me = await issueRequest(recorder, {
    stage: 'supplied-driver.me',
    phase: 'setup',
    method: 'GET',
    path: '/api/v1/auth/me',
    token,
  });
  const actorId = stringValue(me.body?.actor?.id);
  const roles = Array.isArray(me.body?.actor?.roles) ? me.body.actor.roles : [];
  if (me.status !== 200 || !actorId || !roles.includes('DRIVER')) {
    return {
      available: false,
      actorId: null,
      reason: `token-${index}-not-driver`,
    };
  }
  return prepareDriverAvailability({
    token,
    driverId: actorId,
    recorder,
    phase: 'setup',
    locationSequences,
  });
}

async function prepareDriverAvailability({
  token,
  driverId,
  recorder,
  phase,
  locationSequences,
}) {
  const location = await issueRequest(recorder, {
    stage: 'driver.location.initial',
    phase,
    method: 'PUT',
    path: '/api/v1/drivers/me/location',
    token,
    body: locationPayload(locationSequences, driverId, 1),
  });
  if (location.status !== 200) {
    return { available: false, actorId: driverId, reason: 'location-failed' };
  }

  const workState = await issueRequest(recorder, {
    stage: 'driver.work-state.available',
    phase,
    method: 'PUT',
    path: '/api/v1/drivers/me/work-state',
    token,
    body: { state: 'AVAILABLE' },
  });
  if (workState.status !== 200) {
    return {
      available: false,
      actorId: driverId,
      reason: 'availability-failed',
    };
  }
  return { available: true, actorId: driverId };
}

async function refreshDriverLocation({
  token,
  driverId,
  recorder,
  phase,
  locationSequences,
}) {
  await issueRequest(recorder, {
    stage: 'driver.location.heartbeat',
    phase,
    method: 'PUT',
    path: '/api/v1/drivers/me/location',
    token,
    body: locationPayload(locationSequences, driverId),
  });
}

async function runWorkloadPhase({
  customers,
  durationSeconds: phaseDurationSeconds,
  phase,
  recorder,
  summaries,
  driverTokensById,
  completeTrips,
}) {
  const deadline = Date.now() + phaseDurationSeconds * 1_000;
  await Promise.all(
    customers.map(async (customer, workerId) => {
      while (Date.now() < deadline) {
        await runLifecycleAttempt({
          customer,
          workerId,
          phase,
          recorder,
          summary: summaries[phase],
          driverTokensById,
          completeTrips,
        });
        if (intervalMs > 0) await delay(intervalMs);
      }
    }),
  );
}

async function runLifecycleAttempt({
  customer,
  phase,
  recorder,
  summary,
  driverTokensById,
  completeTrips,
}) {
  const correlationId = randomUUID();
  const outcome = {
    quoteSucceeded: false,
    tripCreated: false,
    matched: false,
    accepted: false,
    completed: false,
    noDriverAvailable: false,
    errorCodes: [],
    invariantViolations: [],
  };

  const quote = await issueRequest(recorder, {
    stage: 'quote',
    phase,
    method: 'POST',
    path: '/api/v1/pricing/fare-quotes',
    token: customer.token,
    idempotencyKey: randomUUID(),
    correlationId,
    body: {
      pickup: { label: 'Load Pickup', ...hanoiDemoCoordinates.pickup },
      dropoff: { label: 'Load Dropoff', ...hanoiDemoCoordinates.dropoff },
      serviceType: 'MOTORBIKE_STANDARD',
    },
  });
  if (quote.status !== 201 || !stringValue(quote.body?.id)) {
    return finishAttempt(summary, outcome, quote.errorCode ?? 'QUOTE_FAILED');
  }
  outcome.quoteSucceeded = true;

  const trip = await issueRequest(recorder, {
    stage: 'trip.create',
    phase,
    method: 'POST',
    path: '/api/v1/trips',
    token: customer.token,
    idempotencyKey: randomUUID(),
    correlationId,
    body: { fareQuoteId: quote.body.id },
  });
  if (
    trip.status !== 201 ||
    !stringValue(trip.body?.id) ||
    trip.body?.state !== 'REQUESTED'
  ) {
    return finishAttempt(
      summary,
      outcome,
      trip.errorCode ?? 'TRIP_CREATE_FAILED',
    );
  }
  outcome.tripCreated = true;

  const tripId = trip.body.id;
  const match = await issueRequest(recorder, {
    stage: 'matching',
    phase,
    method: 'POST',
    path: `/api/v1/dispatch/trips/${tripId}/match`,
    token: customer.token,
    idempotencyKey: randomUUID(),
    correlationId,
  });
  if (match.status !== 201) {
    return finishAttempt(summary, outcome, match.errorCode ?? 'MATCH_FAILED');
  }

  const offer = match.body?.offer;
  if (!offer) {
    if (match.body?.tripState === 'NO_DRIVER_AVAILABLE') {
      outcome.noDriverAvailable = true;
      return finishAttempt(summary, outcome);
    }
    outcome.invariantViolations.push(
      'matching-returned-no-offer-without-terminal-state',
    );
    return finishAttempt(summary, outcome, 'MATCHING_RESPONSE_INVALID');
  }
  outcome.matched = true;

  const driverToken = driverTokensById.get(offer.driverId);
  if (!driverToken) {
    return finishAttempt(summary, outcome, 'DRIVER_TOKEN_UNAVAILABLE');
  }
  const accepted = await issueRequest(recorder, {
    stage: 'offer.accept',
    phase,
    method: 'POST',
    path: `/api/v1/dispatch/offers/${offer.id}/accept`,
    token: driverToken,
    idempotencyKey: randomUUID(),
    correlationId,
  });
  if (
    accepted.status !== 201 ||
    accepted.body?.tripState !== 'DRIVER_TO_PICKUP'
  ) {
    return finishAttempt(
      summary,
      outcome,
      accepted.errorCode ?? 'ACCEPT_FAILED',
    );
  }
  outcome.accepted = true;

  if (!completeTrips) return finishAttempt(summary, outcome);

  const arrive = await issueRequest(recorder, {
    stage: 'trip.arrive',
    phase,
    method: 'POST',
    path: `/api/v1/dispatch/trips/${tripId}/arrive`,
    token: driverToken,
    idempotencyKey: randomUUID(),
    correlationId,
  });
  if (arrive.status !== 201 || arrive.body?.state !== 'AT_PICKUP') {
    return finishAttempt(summary, outcome, arrive.errorCode ?? 'ARRIVE_FAILED');
  }

  const started = await issueRequest(recorder, {
    stage: 'trip.start',
    phase,
    method: 'POST',
    path: `/api/v1/dispatch/trips/${tripId}/start`,
    token: driverToken,
    idempotencyKey: randomUUID(),
    correlationId,
  });
  if (started.status !== 201 || started.body?.state !== 'IN_PROGRESS') {
    return finishAttempt(summary, outcome, started.errorCode ?? 'START_FAILED');
  }

  const completed = await issueRequest(recorder, {
    stage: 'trip.complete',
    phase,
    method: 'POST',
    path: `/api/v1/dispatch/trips/${tripId}/complete`,
    token: driverToken,
    idempotencyKey: randomUUID(),
    correlationId,
    body: { actualDistanceMeters: 1_200, actualDurationSeconds: 480 },
  });
  if (completed.status !== 201 || completed.body?.state !== 'COMPLETED') {
    return finishAttempt(
      summary,
      outcome,
      completed.errorCode ?? 'COMPLETE_FAILED',
    );
  }
  outcome.completed = true;
  return finishAttempt(summary, outcome);
}

function finishAttempt(summary, outcome, errorCode) {
  if (errorCode) outcome.errorCodes.push(errorCode);
  summary.record(outcome);
  return outcome;
}

async function issueRequest(
  recorder,
  { stage, phase, method, path, token, body, idempotencyKey, correlationId },
) {
  const startedAt = process.hrtime.bigint();
  let status = 0;
  let responseBody = null;
  let errorCode;
  try {
    const headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    };
    const requestOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs),
    };
    if (body !== undefined) requestOptions.body = JSON.stringify(body);
    const response = await fetch(`${baseUrl}${path}`, requestOptions);
    status = response.status;
    const raw = await response.text();
    responseBody = parseJson(raw);
    errorCode = stringValue(responseBody?.code);
    if (!errorCode && status >= 400) errorCode = `HTTP_${status}`;
  } catch (error) {
    errorCode =
      error?.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  recorder.record({ stage, phase, status, elapsedMs, errorCode });
  return { status, body: responseBody, errorCode, elapsedMs };
}

class MetricsRecorder {
  constructor() {
    this.requests = [];
  }

  record(request) {
    this.requests.push(request);
  }

  summary(phase) {
    const requests = phase
      ? this.requests.filter((request) => request.phase === phase)
      : this.requests;
    const statusCounts = countBy(requests, (request) => request.status);
    const errorCounts = countBy(
      requests.filter((request) => request.errorCode),
      (request) => request.errorCode,
    );
    return {
      requests: requests.length,
      statusCounts,
      errorCounts,
      latencyMs: latencySummary(requests.map((request) => request.elapsedMs)),
      stages: stageSummary(requests),
    };
  }
}

class LifecycleSummary {
  constructor(completeTrips) {
    this.completeTrips = completeTrips;
    this.attempts = 0;
    this.quoteSucceeded = 0;
    this.tripCreated = 0;
    this.matched = 0;
    this.accepted = 0;
    this.completed = 0;
    this.noDriverAvailable = 0;
    this.failed = 0;
    this.errorCounts = new Map();
    this.invariantViolations = [];
  }

  record(outcome) {
    this.attempts += 1;
    if (outcome.quoteSucceeded) this.quoteSucceeded += 1;
    if (outcome.tripCreated) this.tripCreated += 1;
    if (outcome.matched) this.matched += 1;
    if (outcome.accepted) this.accepted += 1;
    if (outcome.completed) this.completed += 1;
    if (outcome.noDriverAvailable) this.noDriverAvailable += 1;
    for (const code of outcome.errorCodes) {
      this.errorCounts.set(code, (this.errorCounts.get(code) ?? 0) + 1);
    }
    this.invariantViolations.push(...outcome.invariantViolations);
    if (
      outcome.errorCodes.length > 0 ||
      outcome.invariantViolations.length > 0
    ) {
      this.failed += 1;
    }
  }

  toJSON() {
    const successful = this.completeTrips ? this.completed : this.accepted;
    return {
      attempts: this.attempts,
      quoteSucceeded: this.quoteSucceeded,
      tripCreated: this.tripCreated,
      matched: this.matched,
      accepted: this.accepted,
      completed: this.completed,
      noDriverAvailable: this.noDriverAvailable,
      failed: this.failed,
      successful,
      successRate: this.attempts ? round(successful / this.attempts) : 0,
      errorCounts: Object.fromEntries(this.errorCounts),
      invariantViolations: this.invariantViolations,
    };
  }
}

function stageSummary(requests) {
  const stages = new Map();
  for (const request of requests) {
    const current = stages.get(request.stage) ?? [];
    current.push(request);
    stages.set(request.stage, current);
  }
  return Object.fromEntries(
    [...stages.entries()].map(([stage, values]) => [
      stage,
      {
        requests: values.length,
        successful: values.filter(
          (value) => value.status >= 200 && value.status < 300,
        ).length,
        statusCounts: countBy(values, (value) => value.status),
        errorCounts: countBy(
          values.filter((value) => value.errorCode),
          (value) => value.errorCode,
        ),
        latencyMs: latencySummary(values.map((value) => value.elapsedMs)),
      },
    ]),
  );
}

function countBy(values, key) {
  const counts = new Map();
  for (const value of values) {
    const name = String(key(value));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function latencySummary(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: round(sorted.at(-1) ?? 0),
  };
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  return round(
    values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)],
  );
}

function locationPayload(sequenceByKey, key, sequence) {
  const nextSequence = sequence === 1 ? 1 : (sequenceByKey.get(key) ?? 0) + 1;
  sequenceByKey.set(key, nextSequence);
  const offset = nextSequence % 100;
  return {
    latitude: hanoiDemoCoordinates.driver.latitude + offset / 100_000,
    longitude: hanoiDemoCoordinates.driver.longitude + offset / 100_000,
    accuracyMeters: 10,
    source: 'SIMULATOR',
    sequenceNumber: nextSequence,
  };
}

function accountSummary(account) {
  return {
    role: account.role,
    email: account.email,
    actorId: account.actorId,
    tokenIssued: Boolean(account.token),
  };
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { nonJsonBody: true };
  }
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readTokens(name) {
  return (process.env[name] ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true/false`);
}

function positiveInteger(value, fallback, maximum, name, allowZero = false) {
  const parsed = Number(value ?? fallback);
  const valid =
    Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid || parsed > maximum) {
    throw new Error(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer <= ${maximum}`,
    );
  }
  return parsed;
}

function nonNegativeInteger(value, fallback, maximum, name) {
  return positiveInteger(value, fallback, maximum, name, true);
}

function assertSafeBaseUrl(value, externalOptIn) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('LOAD_BASE_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('LOAD_BASE_URL must use http or https');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsed.hostname) && !externalOptIn) {
    throw new Error(
      'Refusing non-local LOAD_BASE_URL. Set LOAD_ALLOW_EXTERNAL_URL=true only for an explicitly authorized environment.',
    );
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (mode === 'closed-loop') {
  await runClosedLoop();
} else {
  await runSimpleMode();
}
