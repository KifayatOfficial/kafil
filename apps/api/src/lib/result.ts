// Service-layer result type. Routes translate Result<T> → HTTP responses.
// Keeps services HTTP-agnostic (P2).
export type Ok<T> = { ok: true; value: T };
export type Err = {
  ok: false;
  code:
    | 'VALIDATION'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'FORBIDDEN'
    | 'UNAUTHORIZED'
    | 'RATE_LIMIT'
    | 'INTERNAL';
  message: string;
  details?: unknown;
};
export type Result<T> = Ok<T> | Err;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = (code: Err['code'], message: string, details?: unknown): Err => ({
  ok: false,
  code,
  message,
  details,
});

export const statusFor = (code: Err['code']): number => {
  switch (code) {
    case 'VALIDATION':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'RATE_LIMIT':
      return 429;
    case 'INTERNAL':
    default:
      return 500;
  }
};
