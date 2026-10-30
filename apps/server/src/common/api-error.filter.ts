import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiError } from '#shared/access';
import { DomainError } from './domain-error.js';

const HTTP_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** Semua error HTTP menjadi ApiError netral bahasa; detail internal hanya ke log server. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let body: ApiError = { code: 'INTERNAL', params: {} };
    if (exception instanceof DomainError) {
      status = exception.status;
      body = exception.toApiError();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = { code: HTTP_CODES[status] ?? `HTTP_${status}`, params: {} };
    } else if (isFastifyClientError(exception)) {
      status = exception.statusCode;
      body = { code: HTTP_CODES[status] ?? `HTTP_${status}`, params: {} };
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    void reply.status(status).header('content-type', 'application/json; charset=utf-8').send(body);
  }
}

function isFastifyClientError(error: unknown): error is { statusCode: number } {
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 500;
}
