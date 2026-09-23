import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { DeliveryRepository } from './delivery.repository.js';

export const DELIVERY_EXPIRY_SWEEP_INTERVAL_MS = 5_000;

@Injectable()
export class DeliveryExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryExpiryWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DeliveryRepository) private readonly repository: DeliveryRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.error(
          'Delivery offer expiry sweep failed; the next interval will retry.',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, DELIVERY_EXPIRY_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  runOnce(): Promise<number> {
    return this.repository.expireDueOffers();
  }
}
