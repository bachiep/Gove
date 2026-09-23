import { Inject, Injectable } from '@nestjs/common';

import { LocationRepository } from './location.repository.js';
import type { LatestLocationInput } from './location.schemas.js';

@Injectable()
export class LocationService {
  constructor(
    @Inject(LocationRepository) private readonly repository: LocationRepository,
  ) {}

  async updateLatest(driverUserId: string, input: LatestLocationInput) {
    return this.repository.upsertLatest(driverUserId, input);
  }
}
