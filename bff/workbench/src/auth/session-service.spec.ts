/**
 * Refresh concurrency, outage preservation and logout race regressions.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionService } from "./session-service";
import { Fixture } from "./fixtures.spec-support";

let fixture: Fixture;
let cookie: string;
let id: string;
beforeEach(async () => {
  fixture = new Fixture();
  await fixture.start();
  cookie = await fixture.login();
  id = [...fixture.store.records.keys()][0]!;
});
afterEach(async () => {
  await fixture.stop();
});

async function expire(access = true): Promise<number> {
  const record = (await fixture.store.read(id))!;
  record.session.nextCheckAt = 0;
  if (access) record.session.accessExpiresAt = 0;
  fixture.store.records.set(id, JSON.stringify(record.session));
  return record.session.expiresAt;
}

// ============================================================================
// These tests exercise real token/status transport with injectable storage contracts.
// ============================================================================
describe("RP session lifecycle", () => {
  it("shares one renewal across concurrent bootstrap requests without extending local expiry", async () => {
    const expiry = await expire();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => fixture.request("/api/me", cookie)),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(200),
    );
    expect(fixture.tokenCalls).toBe(2);
    expect(fixture.statusCalls).toBe(2);
    expect((await fixture.store.read(id))!.session.expiresAt).toBe(expiry);
  });
  it("waits for another BFF instance's refresh instead of failing concurrent requests", async () => {
    await expire();
    const other = new SessionService(
      fixture.store,
      fixture.client,
      fixture.config,
    );
    fixture.onToken = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 120));
    const req = { cookies: { [fixture.config.cookieName]: id } } as Parameters<
      typeof other.authenticate
    >[0];
    const [response, identity] = await Promise.all([
      fixture.request("/api/me", cookie),
      other.authenticate(req),
    ]);
    expect(response.status).toBe(200);
    expect(identity.id).toBe(id);
    expect(fixture.tokenCalls).toBe(2);
  });
  it("preserves the RP binding when session status is unavailable and recovers on retry", async () => {
    await expire(false);
    fixture.statusCode = 503;
    expect((await fixture.request("/api/me", cookie)).status).toBe(503);
    expect(await fixture.store.read(id)).not.toBeNull();
    fixture.statusCode = 200;
    expect((await fixture.request("/api/me", cookie)).status).toBe(200);
  });
  it("preserves the binding when refresh is rejected instead of inventing central logout", async () => {
    await expire();
    fixture.tokenStatus = 400;
    const response = await fixture.request("/api/me", cookie);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "WORKBENCH_REFRESH_UNAVAILABLE",
    });
    expect(await fixture.store.read(id)).not.toBeNull();
    expect(fixture.store.revokedSids.size).toBe(0);
  });
  it("ends the local session only on explicit negative central status", async () => {
    await expire(false);
    fixture.central = { valid: false };
    expect((await fixture.request("/api/me", cookie)).status).toBe(401);
    expect(await fixture.store.read(id)).toBeNull();
    expect(fixture.store.revokedSids.has("central-session")).toBe(true);
  });
  it.each(["local", "backchannel"])(
    "cannot resurrect a session during concurrent %s logout",
    async (kind) => {
      await expire();
      let started!: () => void;
      let release!: () => void;
      const waitForToken = new Promise<void>((resolve) => {
        started = resolve;
      });
      const tokenGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fixture.onToken = async () => {
        started();
        await tokenGate;
      };
      const response = fixture.request("/api/me", cookie);
      await waitForToken;
      if (kind === "local") await fixture.store.destroy(id);
      else await fixture.store.revokeSid("central-session");
      release();
      expect((await response).status).toBeGreaterThanOrEqual(400);
      expect(await fixture.store.read(id)).toBeNull();
      expect(fixture.store.records.size).toBe(0);
    },
  );
  it("rejects context changes during refresh without installing the new tokens", async () => {
    await expire();
    const original = fixture.store.records.get(id);
    fixture.accessPatch = {
      active_workspace: "00000000-0000-4000-8000-000000000099",
    };
    expect((await fixture.request("/api/me", cookie)).status).toBe(401);
    expect(fixture.store.records.get(id)).toBe(original);
  });
  it("rechecks the customer account and realm on every request", async () => {
    const record = (await fixture.store.read(id))!;
    record.session.accessToken = fixture.sign({
      userType: "operator",
      account_status: "active",
    });
    fixture.store.records.set(id, JSON.stringify(record.session));
    expect((await fixture.request("/api/me", cookie)).status).toBe(401);
  });
});
