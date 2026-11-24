/**
 * Real HTTP recovery transport must reject malformed, redirected and wrong-scope data.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpIdentityRecoveryClient } from "./identity-recovery.client";

// ============================================================================
// An OS-assigned local server exercises fetch and the full decoding boundary.
// ============================================================================
let server: Server;
let client: HttpIdentityRecoveryClient;
let status = 200;
let body: unknown;
let requests: { authorization: string | undefined; url: string | undefined }[] =
  [];
const binding = {
  issuer: "https://accounts.test",
  audience: "product beta",
  realm: "customer",
  environment: "beta",
  profile: "logout-v1",
};
const active = {
  sid: "sid",
  state: "active",
  sub: "usr_user",
  absolute_expires_at: new Date(Date.now() + 60000).toISOString(),
  session_version: "1",
  context_version: "0",
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    requests.push({ authorization: req.headers.authorization, url: req.url });
    // Drain the actual request before producing a response.
    req.resume();
    await new Promise<void>((resolve) => req.on("end", resolve));
    res.writeHead(status, {
      "content-type": "application/json",
      location: "/redirect-target",
    });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  client = new HttpIdentityRecoveryClient(
    {
      issuer: binding.issuer,
      backchannelIssuer: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      clientId: binding.audience,
      clientSecret: "s:+%secret",
      redirectUri: "https://rp.test/cb",
      scopes: [],
      sessionTtlSec: 300,
    },
    "beta",
  );
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  status = 200;
  requests = [];
  body = { binding, watermark: "cursor", sessions: [active] };
});

describe("logout-v1 recovery transport", () => {
  it("uses confidential form-encoded Basic and returns only validated session evidence", async () => {
    expect(await client.snapshot(["sid"])).toEqual({
      watermark: "cursor",
      sessions: [
        {
          sid: "sid",
          state: "active",
          sub: "usr_user",
          absolute_expires_at: active.absolute_expires_at,
        },
      ],
    });
    expect(
      Buffer.from(requests[0]!.authorization!.slice(6), "base64").toString(),
    ).toBe("product%20beta:s%3A%2B%25secret");
  });
  it.each(["issuer", "audience", "realm", "environment", "profile"])(
    "rejects a mismatched %s",
    async (field) => {
      body = {
        binding: { ...binding, [field]: "foreign" },
        watermark: "cursor",
        sessions: [active],
      };
      await expect(client.snapshot(["sid"])).rejects.toThrow("scope mismatch");
    },
  );
  it.each([
    { sessions: [] },
    { sessions: [{ ...active, sid: "other" }] },
    { sessions: [{ ...active, state: "unknown" }] },
    { sessions: [{ ...active, sub: "opr_user" }] },
    { sessions: [{ ...active, absolute_expires_at: "invalid" }] },
  ])("rejects invalid/incomplete sessions %j", async ({ sessions }) => {
    body = { binding, watermark: "cursor", sessions };
    await expect(client.snapshot(["sid"])).rejects.toThrow();
  });
  it.each([302, 503, 401, 410])(
    "never treats HTTP %s as an inactive session",
    async (code) => {
      status = code;
      await expect(client.snapshot(["sid"])).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );
  it("limits the decoded response size", async () => {
    body = { binding, padding: "x".repeat(1048576) };
    await expect(client.snapshot(["sid"])).rejects.toThrow("exceeds limit");
  });
  it("binds workforce subjects and rejects customer context in its snapshot", async () => {
    const workforce = new HttpIdentityRecoveryClient(
      {
        issuer: binding.issuer,
        clientId: binding.audience,
        clientSecret: "fixture",
        backchannelIssuer: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        redirectUri: "https://rp.test/cb",
        scopes: [],
        sessionTtlSec: 300,
      },
      "beta",
      "logout-v1",
      "workforce",
    );
    body = {
      binding: { ...binding, realm: "workforce" },
      watermark: "cursor",
      sessions: [{ ...active, sub: "opr_user", context: null }],
    };
    await expect(workforce.snapshot(["sid"])).resolves.toMatchObject({
      sessions: [{ sub: "opr_user" }],
    });
    body = {
      binding: { ...binding, realm: "workforce" },
      watermark: "cursor",
      sessions: [{ ...active, sub: "opr_user", context: { org_id: "other" } }],
    };
    await expect(workforce.snapshot(["sid"])).rejects.toThrow(
      "Invalid workforce context",
    );
  });
  it("accepts only supported scoped terminal events", async () => {
    const event = {
      ...binding,
      schema_version: 1,
      type: "session.revoked",
      version: "2",
      event_id: "00000000-0000-4000-8000-000000000000",
      subject: { sid: "sid", sub: "usr_user" },
      cursor: "next",
    };
    body = { binding, events: [event], next_cursor: "next", has_more: false };
    expect((await client.events("previous")).events[0]?.subject.sid).toBe(
      "sid",
    );
    body = {
      binding,
      events: [{ ...event, type: "identity.access_changed" }],
      next_cursor: "next",
      has_more: false,
    };
    await expect(client.events("previous")).rejects.toThrow();
  });
});
