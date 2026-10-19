/**
 * Read stable Runos metadata using the verified current workspace.
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 * @author AI-Generated
 * @date 2026-10-19
 */
import {
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Query,
  Req,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";
import { SelfScope } from "../auth/capability";
import { S2sExchangeService } from "../auth/s2s-exchange.service";
import type { RequestContext } from "../types/console.types";
import {
  parseRunosCatalogPage,
  type RunosCatalogPage,
} from "../types/runos.types";

// --- Session-scoped read ---------------------------------------------------

@SelfScope()
@Controller("api/runos")
export class RunosRouter {
  private readonly baseUrl: string;

  constructor(
    @Inject(VxConfigService) config: VxConfigService,
    @Inject(S2sExchangeService) private readonly exchange: S2sExchangeService,
  ) {
    this.baseUrl = config.platform.RUNOS_API_URL.replace(/\/+$/, "");
  }

  @Get("capabilities")
  @Header("Cache-Control", "private, no-store")
  async capabilities(
    @Req() req: Request & RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<RunosCatalogPage> {
    const tenant = req.tenant;
    if (!req.user)
      throw failure(401, "UNAUTHORIZED", "No active session", false);
    if (
      tenant?.mode !== "tenant" ||
      !tenant.id ||
      !tenant.workspace ||
      !req.activeWorkspaceId ||
      tenant.workspace !== req.activeWorkspaceId ||
      tenant.workspace === "default" ||
      tenant.workspace === "PLATFORM"
    ) {
      throw failure(
        403,
        "RUNOS_CONTEXT_REQUIRED",
        "An accessible active workspace is required",
        false,
      );
    }
    const params = parsePaging(query);
    const url = new URL(`${this.baseUrl}/tenancy/capabilities`);
    url.search = params.toString();
    let bearer: string | null;
    try {
      bearer = await this.exchange.getToken(
        tenant.workspace,
        "runos",
        tenant.id,
      );
    } catch {
      throw failure(
        503,
        "RUNOS_UNAVAILABLE",
        "Runos authentication is unavailable",
        true,
      );
    }
    if (!bearer)
      throw failure(
        503,
        "RUNOS_UNAVAILABLE",
        "Runos authentication is unavailable",
        true,
      );
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw failure(
        503,
        "RUNOS_UNAVAILABLE",
        "Runos catalog is unavailable",
        true,
      );
    }
    if (!response.ok) {
      // Never confuse a rejected service credential with an expired RP session.
      const code = await upstreamCode(response);
      if (response.status === 409 && code === "CAPABILITY_CATALOG_CHANGED") {
        throw failure(
          409,
          code,
          "Catalog changed; restart synchronization",
          false,
        );
      }
      if (
        response.status === 400 &&
        [
          "CAPABILITY_CATALOG_CURSOR_INVALID",
          "CALLER_INVALID_ARGUMENTS",
        ].includes(code)
      ) {
        throw failure(400, code, "Invalid catalog pagination", false);
      }
      throw failure(
        502,
        "RUNOS_UNAVAILABLE",
        "Runos catalog request failed",
        true,
      );
    }
    try {
      return parseRunosCatalogPage(
        await response.json(),
        Number(params.get("limit") ?? 100),
      );
    } catch {
      throw failure(
        502,
        "RUNOS_RESPONSE_INVALID",
        "Runos returned invalid catalog metadata",
        true,
      );
    }
  }
}

// --- Bounded input and sanitized errors ------------------------------------

function parsePaging(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (
      (key !== "cursor" && key !== "limit") ||
      typeof value !== "string" ||
      (key === "cursor" && !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) ||
      (key === "limit" &&
        (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000))
    ) {
      throw failure(
        400,
        "CALLER_INVALID_ARGUMENTS",
        "Only a valid cursor and limit (1–1000) are accepted",
        false,
      );
    }
    params.set(key, value);
  }
  return params;
}

async function upstreamCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    return body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string"
      ? body.code
      : "";
  } catch {
    return "";
  }
}

function failure(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): HttpException {
  return new HttpException({ code, message, retryable }, status);
}
