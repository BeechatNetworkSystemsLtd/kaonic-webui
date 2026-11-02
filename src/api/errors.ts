/** Stable codes the UI branches on. `message` is for display. */
export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_failed'
  | 'rate_limited'
  | 'unavailable'
  | 'network'
  | 'internal';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** Field name → message, for `validation_failed`. */
  readonly fields: Readonly<Record<string, string>>;
  /** The hub's own, finer code (e.g. `foreign_node`), when it sent one. */
  readonly reason: string | null;

  constructor(code: ApiErrorCode, message: string, fields: Record<string, string> = {}, reason: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.reason = reason;
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** Field name → message when `error` rejected some fields; empty otherwise. */
export function validationFields(error: unknown): Readonly<Record<string, string>> {
  return isApiError(error, 'validation_failed') ? error.fields : {};
}

/** Text for any thrown value, for places that only show a message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
