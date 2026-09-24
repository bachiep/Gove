import { randomUUID } from 'node:crypto';

import type { PaymentProvider, PaymentStatus } from '@gove/contracts';

export interface PaymentProviderPlan {
  provider: PaymentProvider;
  status: PaymentStatus;
  providerReference: string | null;
  failureCode: string | null;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  planCapture(input: {
    simulationOutcome?: PaymentStatus;
  }): PaymentProviderPlan;
}

class SimulatorPaymentProvider implements PaymentProviderAdapter {
  readonly provider = 'SIMULATOR' as const;

  planCapture(input: {
    simulationOutcome?: PaymentStatus;
  }): PaymentProviderPlan {
    const status = input.simulationOutcome ?? 'SUCCEEDED';
    return {
      provider: this.provider,
      status,
      providerReference: status === 'SUCCEEDED' ? `sim-${randomUUID()}` : null,
      failureCode:
        status === 'FAILED'
          ? 'SIMULATED_FAILURE'
          : status === 'UNKNOWN'
            ? 'SIMULATED_TIMEOUT'
            : null,
    };
  }
}

class PendingExternalPaymentProvider implements PaymentProviderAdapter {
  constructor(readonly provider: Exclude<PaymentProvider, 'SIMULATOR'>) {}

  planCapture(): PaymentProviderPlan {
    return {
      provider: this.provider,
      status: 'PENDING',
      providerReference: null,
      failureCode: null,
    };
  }
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProvider, PaymentProviderAdapter>(
    [
      new SimulatorPaymentProvider(),
      new PendingExternalPaymentProvider('MOMO'),
      new PendingExternalPaymentProvider('SEPAY'),
    ].map((provider) => [provider.provider, provider]),
  );

  planCapture(input: {
    provider: PaymentProvider;
    simulationOutcome?: PaymentStatus;
  }): PaymentProviderPlan {
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw new Error(`Unsupported payment provider: ${input.provider}`);
    }
    return provider.planCapture(input);
  }
}
