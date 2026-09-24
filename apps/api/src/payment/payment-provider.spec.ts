import { describe, expect, it } from 'vitest';

import { PaymentProviderRegistry } from './payment-provider.js';

describe('PaymentProviderRegistry', () => {
  const providers = new PaymentProviderRegistry();

  it('keeps simulator outcomes deterministic without external network work', () => {
    const result = providers.planCapture({
      provider: 'SIMULATOR',
      simulationOutcome: 'FAILED',
    });

    expect(result).toEqual({
      provider: 'SIMULATOR',
      status: 'FAILED',
      providerReference: null,
      failureCode: 'SIMULATED_FAILURE',
    });
  });

  it.each(['MOMO', 'SEPAY'] as const)(
    'keeps %s pending until a future provider integration resolves it',
    (provider) => {
      expect(
        providers.planCapture({ provider, simulationOutcome: 'SUCCEEDED' }),
      ).toEqual({
        provider,
        status: 'PENDING',
        providerReference: null,
        failureCode: null,
      });
    },
  );
});
