import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();

    const error =
      exception instanceof ApiError
        ? exception
        : exception instanceof HttpException
          ? new ApiError(
              exception.getStatus(),
              'REQUEST_REJECTED',
              'The request could not be completed.',
            )
          : new ApiError(
              HttpStatus.INTERNAL_SERVER_ERROR,
              'INTERNAL_ERROR',
              'The request could not be completed.',
            );

    if (
      !(exception instanceof ApiError) &&
      !(exception instanceof HttpException)
    ) {
      this.logger.error(
        `Unhandled request failure correlationId=${request.id}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      correlationId: request.id,
      ...(error.details ? { details: error.details } : {}),
    });
  }
}
