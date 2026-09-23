import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DeliveryResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import {
  DeliveryCommandError,
  DeliveryRepository,
} from './delivery.repository.js';
import type { CreateDeliveryInput } from './delivery.schemas.js';

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DeliveryRepository) private readonly repository: DeliveryRepository,
  ) {}

  async createDelivery(
    input: CreateDeliveryInput & {
      customerUserId: string;
      idempotencyKey: string;
      correlationId?: string;
    },
  ): Promise<DeliveryResponse> {
    try {
      return await this.repository.createDelivery({
        ...input,
        correlationId: input.correlationId ?? randomUUID(),
        requestFingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              pickup: input.pickup,
              dropoff: input.dropoff,
              recipient: input.recipient,
              parcel: input.parcel,
            }),
          )
          .digest(),
      });
    } catch (error) {
      if (error instanceof DeliveryCommandError) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          error.code,
          'The idempotency key was reused with a different request.',
        );
      }
      throw error;
    }
  }

  async findForCustomer(
    customerUserId: string,
    deliveryId: string,
  ): Promise<DeliveryResponse> {
    const delivery = await this.repository.findForCustomer(
      customerUserId,
      deliveryId,
    );
    if (delivery) return delivery;
    throw new ApiError(
      HttpStatus.NOT_FOUND,
      'DELIVERY_NOT_FOUND',
      'The Delivery was not found.',
    );
  }
}
