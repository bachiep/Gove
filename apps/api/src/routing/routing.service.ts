import { CoordinateFallbackRoutingProvider } from './coordinate-fallback.routing.js';
import {
  RoutingError,
  type RoutingEstimate,
  type RoutingFallbackReason,
  type RoutingMetadata,
  type RoutingProvider,
  type RoutingRequest,
  type RoutingResult,
  validateRoutingRequest,
} from './routing.types.js';

export const defaultRoutingProviderTimeoutMs = 750;
export const maximumRoutingProviderTimeoutMs = 3_000;

export interface RoutingServiceOptions {
  readonly primaryProvider?: RoutingProvider;
  readonly fallbackProvider?: RoutingProvider;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * Stable routing seam for the MVP. A provider may be replaced without
 * changing callers; failures and timeouts produce a clearly marked fallback.
 */
export class RoutingService {
  private readonly primaryProvider: RoutingProvider | undefined;
  private readonly fallbackProvider: RoutingProvider;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: RoutingServiceOptions = {}) {
    this.primaryProvider = options.primaryProvider;
    this.fallbackProvider =
      options.fallbackProvider ?? new CoordinateFallbackRoutingProvider();
    this.timeoutMs = validateTimeout(options.timeoutMs);
    this.now = options.now ?? (() => new Date());

    validateProvider(this.primaryProvider);
    validateProvider(this.fallbackProvider);
  }

  async route(input: RoutingRequest): Promise<RoutingResult> {
    validateRoutingRequest(input);

    let fallbackReason: RoutingFallbackReason = 'PRIMARY_NOT_CONFIGURED';

    if (this.primaryProvider) {
      try {
        const estimate = await routeWithTimeout(
          this.primaryProvider,
          input,
          this.timeoutMs,
        );
        validateEstimate(estimate);

        return this.toResult(estimate, this.primaryProvider, false, null);
      } catch (error) {
        fallbackReason =
          error instanceof RoutingError &&
          error.code === 'ROUTING_PROVIDER_TIMEOUT'
            ? 'PRIMARY_TIMEOUT'
            : 'PRIMARY_ERROR';
      }
    }

    try {
      const estimate = await routeWithTimeout(
        this.fallbackProvider,
        input,
        this.timeoutMs,
      );
      validateEstimate(estimate);

      return this.toResult(
        estimate,
        this.fallbackProvider,
        true,
        fallbackReason,
      );
    } catch {
      throw new RoutingError(
        'ROUTING_UNAVAILABLE',
        'No routing result is available for this request.',
      );
    }
  }

  private toResult(
    estimate: RoutingEstimate,
    provider: RoutingProvider,
    usedFallback: boolean,
    fallbackReason: RoutingFallbackReason | null,
  ): RoutingResult {
    const updatedAt = this.now();
    if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
      throw new RoutingError(
        'INVALID_ROUTING_CONFIGURATION',
        'The routing clock must return a valid Date.',
      );
    }

    const metadata: RoutingMetadata = {
      provider: provider.id,
      version: provider.version,
      updatedAt: updatedAt.toISOString(),
    };

    return {
      ...estimate,
      metadata,
      usedFallback,
      fallbackReason,
    };
  }
}

function validateTimeout(timeoutMs: number | undefined): number {
  const resolvedTimeoutMs = timeoutMs ?? defaultRoutingProviderTimeoutMs;
  if (
    !Number.isInteger(resolvedTimeoutMs) ||
    resolvedTimeoutMs < 1 ||
    resolvedTimeoutMs > maximumRoutingProviderTimeoutMs
  ) {
    throw new RoutingError(
      'INVALID_ROUTING_CONFIGURATION',
      `timeoutMs must be an integer between 1 and ${maximumRoutingProviderTimeoutMs}.`,
    );
  }

  return resolvedTimeoutMs;
}

function validateProvider(provider: RoutingProvider | undefined): void {
  if (!provider) return;

  if (
    typeof provider.id !== 'string' ||
    typeof provider.version !== 'string' ||
    !provider.id.trim() ||
    !provider.version.trim()
  ) {
    throw new RoutingError(
      'INVALID_ROUTING_CONFIGURATION',
      'A routing provider must declare non-empty id and version metadata.',
    );
  }
}

function validateEstimate(estimate: RoutingEstimate): void {
  if (
    !Number.isFinite(estimate.distanceMeters) ||
    estimate.distanceMeters < 0 ||
    !Number.isFinite(estimate.durationSeconds) ||
    estimate.durationSeconds < 0 ||
    !Number.isInteger(estimate.durationSeconds) ||
    estimate.geometry.type !== 'LineString' ||
    estimate.geometry.coordinates.length < 2
  ) {
    throw new RoutingError(
      'ROUTING_PROVIDER_ERROR',
      'The routing provider returned an invalid estimate.',
    );
  }

  for (const [longitude, latitude] of estimate.geometry.coordinates) {
    if (
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new RoutingError(
        'ROUTING_PROVIDER_ERROR',
        'The routing provider returned invalid geometry coordinates.',
      );
    }
  }
}

async function routeWithTimeout(
  provider: RoutingProvider,
  input: RoutingRequest,
  timeoutMs: number,
): Promise<RoutingEstimate> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const providerAttempt = Promise.resolve().then(() =>
    provider.route(input, controller.signal),
  );
  // A provider may ignore AbortSignal and reject after the timeout winner.
  // Attach a handler so that late provider failures cannot become unhandled
  // promise rejections while preserving the original race result.
  void providerAttempt.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new RoutingError(
          'ROUTING_PROVIDER_TIMEOUT',
          `Routing provider exceeded the ${timeoutMs}ms timeout.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([providerAttempt, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
