import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
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

    response.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      correlationId: request.id,
      ...(error.details ? { details: error.details } : {}),
    });
  }
}
