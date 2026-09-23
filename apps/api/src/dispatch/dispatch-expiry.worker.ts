import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { DispatchRepository } from './dispatch.repository.js';

export const DISPATCH_EXPIRY_SWEEP_INTERVAL_MS = 5_000;

@Injectable()
export class DispatchExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchExpiryWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DispatchRepository)
    private readonly repository: DispatchRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.error(
          'Dispatch expiry sweep failed; the next interval will retry.',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, DISPATCH_EXPIRY_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  runOnce(): Promise<number> {
    return this.repository.expireDueOffers();
  }
}
