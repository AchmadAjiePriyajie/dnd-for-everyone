import type { ApiError, ErrorCode } from '#shared/access';

/** Error domain yang aman dikirim ke client: hanya kode + parameter, tanpa kalimat/rahasia. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly params: ApiError['params'] = {},
  ) {
    super(code);
    this.name = 'DomainError';
  }

  toApiError(): ApiError {
    return { code: this.code, params: this.params };
  }
}

export const forbidden = () => new DomainError('FORBIDDEN', 403);
