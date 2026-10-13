/**
 * Token endpoint grant selection and credential forwarding regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-12
 */
import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OidcService } from "../oidc/oidc.service";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "../oidc/token-exchange.service";
import { OidcRouter } from "./oidc.router";

describe("token endpoint discovery scope", () => {
  it("forwards explicit discovery scope with Basic credentials and no workspace", async () => {
    const tokenExchange = vi
      .fn()
      .mockResolvedValue({ access_token: "read-ticket" });
    const router = new OidcRouter(
      { tokenExchange } as unknown as OidcService,
      {} as VxConfigService,
    );
    await router.token(
      {
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        audience: "vxture",
        scope: "provisioning:read",
        client_id: "ignored",
        client_secret: "ignored",
      },
      `Basic ${Buffer.from("arda:secret").toString("base64")}`,
    );
    expect(tokenExchange).toHaveBeenCalledWith(
      { clientId: "arda", clientSecret: "secret" },
      {
        audience: "vxture",
        scope: "provisioning:read",
        subjectToken: undefined,
        workspaceId: undefined,
        orgId: undefined,
      },
    );
  });

  it("preserves workspace grants without an explicit scope", async () => {
    const tokenExchange = vi
      .fn()
      .mockResolvedValue({ access_token: "workspace-ticket" });
    const router = new OidcRouter(
      { tokenExchange } as unknown as OidcService,
      {} as VxConfigService,
    );
    await router.token({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      client_id: "arda",
      client_secret: "secret",
      audience: "vxture",
      workspace_id: "ws-1",
    });
    expect(tokenExchange).toHaveBeenCalledWith(
      { clientId: "arda", clientSecret: "secret" },
      expect.objectContaining({ scope: undefined, workspaceId: "ws-1" }),
    );
  });
});
