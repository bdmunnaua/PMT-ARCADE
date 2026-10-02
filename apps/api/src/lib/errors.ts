import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '@arena/shared';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`);
export const forbidden = (message?: string) => new AppError('FORBIDDEN', message);
export const invalidState = (message?: string) => new AppError('INVALID_STATE_TRANSITION', message);
export const alreadyProcessed = (message?: string) => new AppError('ALREADY_PROCESSED', message);
