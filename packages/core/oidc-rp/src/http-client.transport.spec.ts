/**
 * Token endpoint failure classification over real HTTP.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpOidcRpClient } from "./http-client";

// ============================================================================
// Local upstream with real socket, redirect, and response failures
// ============================================================================

let server: Server;
let base: string;
let status = 503;
let payload: unknown;
let mode: "response" | "disconnect" | "redirect" | "stall" = "response";
let requests = 0;
beforeAll(async () => {
  server = createServer((_request, response) => {
    requests += 1;
    if (mode === "disconnect") {
      response.destroy();
      return;
    }
    if (mode === "stall") return;
    if (mode === "redirect") {
      response.writeHead(302, { location: `${base}/unexpected-target` });
      response.end();
      return;
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
function client() {
  return new HttpOidcRpClient({
    issuer: base,
    clientId: "test",
    clientSecret: "test",
    redirectUri: `${base}/callback`,
    scopes: ["openid"],
    sessionTtlSec: 3600,
  });
}

// ============================================================================
// Never turn a transport failure into central logout evidence
// ============================================================================

describe("token transport", () => {
  it.each([
    [400, { error: "invalid_grant" }, true],
    [503, { error: "invalid_grant" }, false],
    [401, { error: "invalid_client" }, false],
    [200, { access_token: "incomplete" }, false],
  ] as const)(
    "classifies HTTP %s without exposing the response",
    async (code, body, reauthorizationRequired) => {
      mode = "response";
      status = code;
      payload = body;
      await expect(client().refresh("secret-refresh")).rejects.toMatchObject({
        reauthorizationRequired,
      });
    },
  );

  it("rejects disconnected upstreams", async () => {
    mode = "disconnect";
    await expect(client().refresh("secret-refresh")).rejects.toThrow();
  });

  it("does not follow redirects with client credentials", async () => {
    mode = "redirect";
    const before = requests;
    await expect(client().refresh("secret-refresh")).rejects.toThrow();
    expect(requests - before).toBe(1);
  });

  it("bounds a stalled token request", async () => {
    mode = "stall";
    await expect(client().refresh("secret-refresh")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  }, 15000);
});
