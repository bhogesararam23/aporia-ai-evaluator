export const APP_ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNSAFE_URL',
  'INTERNAL_ERROR',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSAFE_URL: 400,
  INTERNAL_ERROR: 500,
};

const PUBLIC_MESSAGE_BY_CODE: Record<AppErrorCode, string> = {
  INVALID_INPUT: 'The submitted input is invalid.',
  NOT_FOUND: 'The requested record was not found.',
  CONFLICT: 'The requested change conflicts with the current state.',
  FORBIDDEN: 'The request was not allowed.',
  METHOD_NOT_ALLOWED: 'That method is not allowed for this resource.',
  PAYLOAD_TOO_LARGE: 'The request is larger than the configured limit.',
  UNSUPPORTED_MEDIA_TYPE: 'That content type is not supported.',
  UNSAFE_URL: 'The URL is not an allowed HTTP or HTTPS address.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: AppErrorCode, message?: string) {
    const publicMessage = message ?? PUBLIC_MESSAGE_BY_CODE[code];
    super(publicMessage);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.publicMessage = publicMessage;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toPublicError(error: unknown): {
  code: AppErrorCode;
  message: string;
  status: number;
} {
  if (isAppError(error)) {
    return { code: error.code, message: error.publicMessage, status: error.status };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: PUBLIC_MESSAGE_BY_CODE.INTERNAL_ERROR,
    status: STATUS_BY_CODE.INTERNAL_ERROR,
  };
}
