/**
 * atlas-health.client.spec.ts - Token and health wire failure regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-19
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { VxConfigService } from "@vxture/core-config";
import { AtlasHealthClient } from "./atlas-health.client";

// ============================================================================
// Fixtures
// ============================================================================

const snapshot = {
  generatedAt: "2026-10-19T00:00:00.000Z",
  models: [{ modelCode: "m", providerCode: "p", state: "unknown" }],
  routes: [
    {
      code: "chat/a",
      state: "degraded",
      severity: "warning",
      primary: { modelCode: "m", state: "unavailable" },
      fallback: null,
      configIssues: [
        { role: "primary", modelCode: "m", code: "no_key", detail: "no key" },
      ],
    },
  ],
  vendors: [
    {
      providerCode: "p",
      state: "balance_low",
      balance: 12,
      settings: { minAmount: 100 },
    },
  ],
  atlas: [{ component: "request_log", state: "failing" }],
};
const ticket = {
  access_token: "private-ticket",
  token_type: "Bearer",
  expires_in: 300,
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
function client(secret = "private-secret"): AtlasHealthClient {
  return new AtlasHealthClient({
    platform: {
      OIDC_CLIENT_ID: "platform-api",
      OIDC_CLIENT_SECRET: secret,
      AUTH_BFF_URL: "https://idp.example/",
      ATLAS_API_URL: "https://atlas.example/",
    },
  } as unknown as VxConfigService);
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ============================================================================
// Credentials, caching and response validation
// ============================================================================

describe("AtlasHealthClient", () => {
  it("fails missing credentials without any HTTP request", async () => {
    await expect(client("  ").getHealth()).rejects.toThrow(/credentials/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges a workspace-less Atlas ticket and caches it for later reads", async () => {
    fetchMock
      .mockResolvedValueOnce(json(ticket))
      .mockImplementation(async () => json(snapshot));
    const c = client();
    expect(await c.getHealth()).toEqual(snapshot);
    await c.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://idp.example/oidc/token");
    const params = new URLSearchParams(String(options?.body));
    expect(Object.fromEntries(params)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: "platform-api",
      client_secret: "private-secret",
      audience: "atlas",
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://atlas.example/s2s/health",
      expect.objectContaining({
        headers: { authorization: "Bearer private-ticket" },
        signal: expect.any(AbortSignal),
        redirect: "error",
      }),
    ]);
  });

  it("shares one token request across concurrent readers", async () => {
    let resolve!: (v: Response) => void;
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolve = r;
        }),
      )
      .mockImplementation(async () => json(snapshot));
    const c = client();
    const reads = [c.getHealth(), c.getHealth()];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json(ticket));
    await Promise.all(reads);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors a short expires_in rather than a fixed five-minute cache", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/oidc/token")
        ? json({ ...ticket, expires_in: 2 })
        : json(snapshot),
    );
    const c = client();
    await c.getHealth();
    await vi.advanceTimersByTimeAsync(1_900);
    await c.getHealth();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/oidc/token"),
      ),
    ).toHaveLength(2);
  });

  it("does not extend expiry by the exchange latency", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      return json({ ...ticket, expires_in: 2 });
    });
    const result = expect(client().getHealth()).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(2_500);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { ...ticket, access_token: 3 },
    { ...ticket, access_token: " " },
    { ...ticket, token_type: "Basic" },
    { ...ticket, expires_in: "300" },
    { ...ticket, expires_in: 0 },
    { ...ticket, expires_in: -1 },
  ])("rejects malformed token response %#", async (body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(client().getHealth()).rejects.toThrow(/invalid ticket/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { ...snapshot, generatedAt: "invalid" },
    { ...snapshot, models: [{}] },
    { ...snapshot, routes: [{ ...snapshot.routes[0], fallback: {} }] },
    { ...snapshot, routes: [{ ...snapshot.routes[0], configIssues: [null] }] },
    {
      ...snapshot,
      models: [{ modelCode: "m", providerCode: "p", state: "new-state" }],
    },
    {
      ...snapshot,
      vendors: [{ providerCode: "p", state: "balance_low", balance: "0" }],
    },
    { ...snapshot, atlas: [{ component: "request_log", state: "down" }] },
    { ...snapshot, atlas: [{ component: "invented", state: "ok" }] },
  ])("rejects malformed consumed snapshot fields %#", async (body) => {
    fetchMock
      .mockResolvedValueOnce(json(ticket))
      .mockResolvedValueOnce(json(body));
    await expect(client().getHealth()).rejects.toThrow(/invalid snapshot/);
  });

  it("clears a 401 ticket and re-exchanges on the next read", async () => {
    fetchMock
      .mockResolvedValueOnce(json(ticket))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ...ticket, access_token: "fresh-ticket" }))
      .mockResolvedValueOnce(json(snapshot));
    const c = client();
    await expect(c.getHealth()).rejects.toThrow(/health read failed/);
    await c.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toEqual({
      authorization: "Bearer fresh-ticket",
    });
  });

  it.each([401, 503])(
    "retries a failed token exchange on a later read (%i)",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(json({ error: "private-secret" }, status))
        .mockResolvedValueOnce(json(ticket))
        .mockResolvedValueOnce(json(snapshot));
      const c = client();
      await expect(c.getHealth()).rejects.toThrow(
        /^Atlas health token exchange failed/,
      );
      await expect(c.getHealth()).resolves.toEqual(snapshot);
    },
  );

  it("does not expose upstream response bodies or transport secrets", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private-secret private-ticket"));
    await expect(client().getHealth()).rejects.toThrow(
      "Atlas health token exchange failed (HTTP, transport, timeout or invalid JSON)",
    );
  });

  // ========================================================================
  // End-to-end deadlines cover fetch and JSON decoding independently.
  // ========================================================================

  it.each(["token headers", "token body", "health headers", "health body"])(
    "bounds %s hangs and aborts the request",
    async (stage) => {
      vi.useFakeTimers();
      const never = (): Promise<Response> => new Promise(() => {});
      const slowBody = (): Response =>
        ({
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
        }) as Response;
      if (stage.startsWith("health"))
        fetchMock.mockResolvedValueOnce(json(ticket));
      if (stage.endsWith("headers")) fetchMock.mockImplementationOnce(never);
      else fetchMock.mockResolvedValueOnce(slowBody());
      const c = client();
      const result = expect(c.getHealth()).rejects.toThrow(/failed/);
      await vi.advanceTimersByTimeAsync(10_001);
      await result;
      const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      fetchMock
        .mockResolvedValueOnce(json(ticket))
        .mockResolvedValueOnce(json(snapshot));
      // A failed token request must release the single-flight promise.
      if (stage.startsWith("token"))
        await expect(c.getHealth()).resolves.toEqual(snapshot);
    },
  );
});

// ============================================================================
// Real HTTP smoke: form exchange and authenticated snapshot decoding
// ============================================================================

describe("AtlasHealthClient over HTTP", () => {
  it("sends the confined grant and consumes a real HTTP snapshot", async () => {
    vi.unstubAllGlobals();
    const requests: {
      path: string;
      method: string;
      body: string;
      auth: string | undefined;
    }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({
        path: req.url ?? "",
        method: req.method ?? "",
        body: Buffer.concat(chunks).toString(),
        auth: req.headers.authorization,
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/oidc/token" ? ticket : snapshot));
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const c = new AtlasHealthClient({
        platform: {
          OIDC_CLIENT_ID: "platform-api",
          OIDC_CLIENT_SECRET: "fixture-secret",
          AUTH_BFF_URL: base,
          ATLAS_API_URL: base,
        },
      } as unknown as VxConfigService);
      await expect(c.getHealth()).resolves.toEqual(snapshot);
      expect(requests.map((r) => [r.method, r.path])).toEqual([
        ["POST", "/oidc/token"],
        ["GET", "/s2s/health"],
      ]);
      expect(
        Object.fromEntries(new URLSearchParams(requests[0]?.body)),
      ).toEqual({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: "platform-api",
        client_secret: "fixture-secret",
        audience: "atlas",
      });
      expect(requests[1]?.auth).toBe("Bearer private-ticket");
      expect(requests[1]?.body).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
