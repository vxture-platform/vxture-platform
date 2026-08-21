/**
 * error.utils.ts - HTTP Error Normalization
 * @package @vxture/core-api
 * @description
 *   Maps axios errors and HTTP status codes to VxtureError subclasses.
 *   Consumers only need to handle VxtureError without worrying about underlying HTTP details.
 *
 * @author AI-Generated
 * @date 2026-03-15
 */

import {
  VxtureError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
} from "@vxture-platform/shared";

import type { ApiErrorBody } from "../types/api.types";

// ============================================================================
// HTTP Status → VxtureError
// ============================================================================

/**
 * Converts HTTP status code and error information to corresponding VxtureError subclass
 *
 * @example
 * // Use in axios response interceptor
 * if (error.response) {
 *   throw normalizeHttpError(error.response.status, error.response.data);
 * }
 */
export function normalizeHttpError(
  status: number,
  body?: Partial<ApiErrorBody>,
  requestId?: string,
): VxtureError {
  const message = body?.message ?? defaultMessageForStatus(status);
  const code = body?.code ?? `HTTP_${status}`;
  const details = body?.details;
  const metadata = {
    code,
    status,
    details,
    ...(requestId !== undefined ? { requestId } : {}),
  };

  switch (status) {
    case 400:
      return new ValidationError(message, metadata);
    case 401:
      return new UnauthorizedError(message, metadata);
    case 403:
      return new ForbiddenError(message, metadata);
    case 404:
      return new NotFoundError(message, metadata);
    case 409:
      return new ConflictError(message, metadata);
    case 422:
      return new ValidationError(message, metadata);
    case 429:
      return new VxtureError(message, { ...metadata, code: "RATE_LIMITED" });
    case 503:
      return new VxtureError(message, {
        ...metadata,
        code: "SERVICE_UNAVAILABLE",
      });
    default:
      if (status >= 500) return new InternalServerError(message, metadata);
      return new VxtureError(message, metadata);
  }
}

/**
 * Determines if a request should be retried (network error or 5xx)
 */
export function isRetryableError(
  status?: number,
  isNetworkError = false,
): boolean {
  if (isNetworkError) return true;
  if (!status) return false;
  // 429 Too Many Requests and 5xx can be retried; 4xx client errors are not retried
  return status === 429 || status >= 500;
}

// ============================================================================
// Internal Utilities
// ============================================================================

function defaultMessageForStatus(status: number): string {
  const messages: Record<number, string> = {
    400: "Bad request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    422: "Unprocessable entity",
    429: "Too many requests",
    500: "Internal server error",
    502: "Bad gateway",
    503: "Service unavailable",
    504: "Gateway timeout",
  };
  return messages[status] ?? `HTTP error ${status}`;
}
