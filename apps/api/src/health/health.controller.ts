import type { HealthResponse, ReadinessResponse } from '@gove/contracts';
import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DatabaseService } from '../database/database.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiOkResponse({ description: 'The API process is alive' })
  live(): HealthResponse {
    return {
      service: 'gove-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check required dependencies' })
  @ApiOkResponse({ description: 'All required dependencies are ready' })
  async ready(): Promise<ReadinessResponse> {
    try {
      const result = await this.database.query<{ version: string }>(
        'SELECT PostGIS_Version() AS version',
      );
      const version = result.rows[0]?.version;
      if (!version) throw new Error('PostGIS version was not returned');

      return {
        ...this.live(),
        dependencies: { postgres: 'ready', postgis: version },
      };
    } catch (error) {
      this.logger.error(
        'Readiness check failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'A required dependency is unavailable',
      });
    }
  }
}
