/**
 * Consistent public errors without tokens, upstream bodies, or internal addresses.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category middleware
 * @author AI-Generated
 * @date 2026-11-05
 */
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

/**
 * Construct the platform error envelope.
 * @param status - HTTP failure status.
 * @param code - Stable machine-readable code.
 * @param message - Public explanation.
 * @returns An exception containing no private upstream data.
 */
export function failure(
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ code, message, retryable: status >= 500 }, status);
}

@Catch()
export class PublicErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const body = error instanceof HttpException ? error.getResponse() : null;
    response.setHeader("Cache-Control", "private, no-store");
    response.status(status).json(
      typeof body === "object" && body !== null && "code" in body
        ? body
        : {
            code:
              status === 404 ? "WORKBENCH_NOT_FOUND" : "WORKBENCH_UNAVAILABLE",
            message:
              status === 404
                ? "Endpoint not found"
                : "Service temporarily unavailable",
            retryable: status >= 500,
          },
    );
  }
}
