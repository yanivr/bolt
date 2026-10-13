import type { Response } from 'express';
import type { ApiError, ErrorCode } from '@bolt/shared';

/**
 * Every failed API call answers with the same body shape: a stable machine-readable code the
 * client can branch on and a plain-English sentence it can show. Internals never leak here.
 */

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  VERSION_MISMATCH: 409,
  UNKNOWN_TRACK: 404,
  UNKNOWN_PART: 404,
  ILLEGAL_BUILD: 422,
  CATALOG_MISMATCH: 409,
  RATE_LIMITED: 429,
  SERVER_FULL: 503,
  NOT_FOUND: 404,
  INTERNAL: 500,
  INVITE_EXPIRED: 404,
  LOBBY_FULL: 409,
};

export function errorBody(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

export function sendError(
  res: Response,
  code: ErrorCode,
  message: string,
  status = ERROR_STATUS[code],
): void {
  res.status(status).set('Cache-Control', 'no-store').json(errorBody(code, message));
}
