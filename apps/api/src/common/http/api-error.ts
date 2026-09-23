import { HttpException, type HttpStatus } from '@nestjs/common';

export interface ApiFieldError {
  field: string;
  reason: string;
}

export class ApiError extends HttpException {
  constructor(
    readonly httpStatus: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: readonly ApiFieldError[],
  ) {
    super(message, httpStatus);
  }
}
