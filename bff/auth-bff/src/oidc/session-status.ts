/**
 * Central-session status protocol validation and errors.
 * @package @vxture/bff-auth
 * @layer Application
 * @category types
 * @author AI-Generated
 * @date 2026-10-21
 */
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { OidcClientCredentials } from "./oidc.service";

/** A status deadline is a check schedule, never a renewable login lifetime. */
export type OidcSessionStatus =
  | { valid: true; next_check_at: number }
  | { valid: false };

/** Authentication failures do not assert that a user's session has ended. */
export function sessionStatusUnauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    code: "INVALID_CLIENT",
    message: "Confidential client authentication required",
    retryable: false,
  });
}

/** Store failures must never be converted into valid:false. */
export function sessionStatusUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "SESSION_STATUS_UNAVAILABLE",
    message: "Central session status unavailable",
    retryable: true,
  });
}

/** @throws {BadRequestException} For unknown fields or invalid request values. */
export function parseSessionStatusBody(body: unknown): {
  sid: string;
  active: boolean;
} {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length === 2 &&
      typeof fields.sid === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(fields.sid) &&
      typeof fields.active === "boolean"
    ) {
      return { sid: fields.sid, active: fields.active };
    }
  }
  throw new BadRequestException({
    code: "INVALID_REQUEST",
    message: "Expected only sid and boolean active in a JSON object",
    retryable: false,
  });
}

// ── Basic authentication (no Cookie, Bearer or body-secret fallback) ──

/** @throws {UnauthorizedException} For missing or malformed Basic credentials. */
export function parseSessionStatusCredentials(
  authorization: string | undefined,
): OidcClientCredentials {
  const match =
    authorization?.length && authorization.length <= 4096
      ? /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
      : null;
  if (match?.[1]) {
    const encoded = match[1];
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") === encoded) {
      const decoded = bytes.toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0 && Buffer.from(decoded, "utf8").equals(bytes)) {
        try {
          const decode = (value: string) =>
            decodeURIComponent(value.replace(/\+/g, " "));
          const clientId = decode(decoded.slice(0, separator));
          const clientSecret = decode(decoded.slice(separator + 1));
          if (
            clientId &&
            clientSecret &&
            !/[\x00-\x1f\x7f]/.test(clientId + clientSecret)
          ) {
            return { clientId, clientSecret };
          }
        } catch {
          // Malformed form encoding is an authentication error, not a 500.
        }
      }
    }
  }
  throw sessionStatusUnauthorized();
}
