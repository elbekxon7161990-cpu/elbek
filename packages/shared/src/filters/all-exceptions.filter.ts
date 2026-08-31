import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';

interface ErrorEnvelope {
  statusCode: number;
  errorCode: string;
  message: string;
  timestamp: string;
  path?: string;
}

/**
 * Global error handling for the HTTP surface (apps/api). A single catch-all
 * filter guarantees every unhandled exception — HttpException or otherwise —
 * still produces the same response envelope shape (Chapter 14 §14.6's error
 * format), rather than an inconsistent shape depending on whether a
 * particular code path happened to throw an HttpException.
 *
 * This filter deliberately contains no business logic: it formats and logs,
 * nothing else. Business-rule-specific error types are expected to already
 * be HttpException subclasses (or mapped to one) by the time they reach here
 * — mapping domain errors to HTTP status codes is an apps/api-layer concern,
 * not this shared filter's.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: ErrorEnvelope) => void };
    }>();
    const request = ctx.getRequest<{ url?: string }>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException ? this.extractMessage(exception) : 'Internal server error';

    const envelope: ErrorEnvelope = {
      statusCode,
      errorCode: isHttpException ? exception.constructor.name : 'INTERNAL_SERVER_ERROR',
      message,
      timestamp: new Date().toISOString(),
      path: request?.url,
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception on ${envelope.path ?? 'unknown path'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${envelope.errorCode}: ${message} (${envelope.path ?? 'unknown path'})`);
    }

    response.status(statusCode).json(envelope);
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const raw = (response as { message: unknown }).message;
      return Array.isArray(raw) ? raw.join(', ') : String(raw);
    }
    return exception.message;
  }
}
