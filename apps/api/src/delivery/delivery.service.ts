import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  DeliveryMatchResponse,
  DeliveryOfferResponse,
  DeliveryResponse,
} from '@gove/contracts';

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

  async startMatching(input: {
    customerUserId: string;
    deliveryId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<DeliveryMatchResponse> {
    try {
      return await this.repository.startMatching({
        ...input,
        correlationId: input.correlationId ?? randomUUID(),
        requestFingerprint: createHash('sha256')
          .update(JSON.stringify({ deliveryId: input.deliveryId }))
          .digest(),
      });
    } catch (error) {
      throw this.mapDispatchError(error);
    }
  }

  async acceptOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<DeliveryOfferResponse> {
    try {
      return await this.repository.acceptOffer({
        ...input,
        correlationId: input.correlationId ?? randomUUID(),
      });
    } catch (error) {
      throw this.mapDispatchError(error);
    }
  }

  private mapDispatchError(error: unknown): ApiError {
    if (!(error instanceof DeliveryCommandError)) throw error;
    const status =
      error.code === 'DELIVERY_NOT_FOUND' || error.code === 'OFFER_NOT_FOUND'
        ? HttpStatus.NOT_FOUND
        : HttpStatus.CONFLICT;
    const messages: Record<DeliveryCommandError['code'], string> = {
      IDEMPOTENCY_KEY_REUSED:
        'The idempotency key was reused with a different request.',
      DELIVERY_NOT_FOUND: 'The Delivery was not found.',
      DELIVERY_NOT_MATCHABLE: 'The Delivery is not available for matching.',
      OFFER_NOT_FOUND: 'The Delivery Offer was not found.',
      OFFER_NOT_FOR_DRIVER:
        'The Delivery Offer is not assigned to this Driver.',
      OFFER_ALREADY_RESOLVED: 'The Delivery Offer has already been resolved.',
      OFFER_EXPIRED: 'The Delivery Offer has expired.',
      DRIVER_WORK_STATE_CONFLICT:
        'The Driver has an active operational commitment.',
    };
    return new ApiError(status, error.code, messages[error.code]);
  }
}
