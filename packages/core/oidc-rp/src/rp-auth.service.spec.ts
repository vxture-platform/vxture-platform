import { describe, it, expect } from "vitest";
import { RpAuthService } from "./rp-auth.service";
import { RpSessionStore, type RpRedis } from "./rp-session.store";
import type { OidcRpClient, OidcTokenSet, RpSession } from "./types";

function fakeRedis(): RpRedis {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    async eval(_script: string, _count: number, ...args: (string | number)[]) {
      if (_script.includes("destroy-unchanged-session")) {
        const [key, index, raw, id] = args.map(String);
        if (kv.get(key!) !== raw) return 0;
        kv.delete(key!);
        sets.get(index!)?.delete(id!);
        return 1;
      }
      const [key, index, raw, , id, expected] = args.map(String);
      const existing = kv.get(key!);
      if (!existing) return 0;
      const current = JSON.parse(existing) as RpSession;
      const next = JSON.parse(raw!) as RpSession;
      if (
        current.sid !== next.sid ||
        current.sub !== next.sub ||
        (expected && current.refreshToken !== expected)
      )
        return 0;
      kv.set(key!, raw!);
      const set = sets.get(index!) ?? new Set<string>();
      set.add(id!);
      sets.set(index!, set);
      return 1;
    },
    async get(k) {
      return kv.get(k) ?? null;
    },
    async setex(k, _t, v) {
      kv.set(k, v);
    },
    async del(...keys) {
      keys.forEach((k) => {
        kv.delete(k);
        sets.delete(k);
      });
    },
    async sadd(k, ...m) {
      const s = sets.get(k) ?? new Set();
      m.forEach((x) => s.add(x));
      sets.set(k, s);
    },
    async srem(k, ...m) {
      m.forEach((x) => sets.get(k)?.delete(x));
    },
    async smembers(k) {
      return [...(sets.get(k) ?? [])];
    },
    async expire() {},
  };
}

const now = () => Math.floor(Date.now() / 1000);

/** OidcRpClient stub: only refresh + verifyAccessToken are exercised here. */
function fakeClient(opts: {
  refresh?: () => Promise<OidcTokenSet>;
  verify?: (t: string) => Promise<Record<string, unknown>>;
}): OidcRpClient {
  return {
    buildAuthorizeUrl: () => "",
    exchangeCode: async () => ({}) as OidcTokenSet,
    refresh: opts.refresh ?? (async () => ({}) as OidcTokenSet),
    verifyIdToken: async () => ({}) as never,
    verifyAccessToken:
      opts.verify ??
      (async () => ({ sub: "usr_1", active_org: "org_1", roles: [] })),
    verifyLogoutToken: async () => ({ sid: "sidA" }),
    buildEndSessionUrl: () => "",
  };
}

function session(overrides: Partial<RpSession> = {}): RpSession {
  return {
    sid: "sidA",
    sub: "usr_1",
    idToken: "id",
    accessToken: "acc",
    refreshToken: "ref",
    accessExpiresAt: now() + 3600,
    activeOrg: "org_1",
    ...overrides,
  };
}

describe("RpAuthService.resolve", () => {
  it("returns expired when rpsid is missing or no session", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    const svc = new RpAuthService(store, fakeClient({}), 3600);
    expect((await svc.resolve(undefined)).status).toBe("expired");
    expect((await svc.resolve("nope")).status).toBe("expired");
  });

  it("verifies a fresh session without refreshing", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rps1", session(), 3600);
    let refreshCalled = false;
    const svc = new RpAuthService(
      store,
      fakeClient({
        refresh: async () => {
          refreshCalled = true;
          return {} as OidcTokenSet;
        },
      }),
      3600,
    );
    const out = await svc.resolve("rps1");
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.refreshed).toBe(false);
      expect(out.claims.sub).toBe("usr_1");
    }
    expect(refreshCalled).toBe(false);
  });

  it("refreshes when the access token is near expiry and persists the rotation", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rps1", session({ accessExpiresAt: now() + 10 }), 3600); // within skew
    const svc = new RpAuthService(
      store,
      fakeClient({
        refresh: async () => ({
          idToken: "id2",
          accessToken: "acc2",
          refreshToken: "ref2",
          accessExpiresAt: now() + 3600,
        }),
      }),
      3600,
    );
    const out = await svc.resolve("rps1");
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.refreshed).toBe(true);
    // rotation persisted server-side
    expect((await store.get("rps1"))?.accessToken).toBe("acc2");
  });

  it("returns expired and drops the session when refresh fails (reuse/revoked)", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rps1", session({ accessExpiresAt: now() + 5 }), 3600);
    const svc = new RpAuthService(
      store,
      fakeClient({
        refresh: async () => {
          throw new Error("invalid_grant");
        },
      }),
      3600,
    );
    expect((await svc.resolve("rps1")).status).toBe("expired");
    expect(await store.get("rps1")).toBeNull(); // dropped
  });

  it("returns expired when access-token verification fails", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rps1", session(), 3600);
    const svc = new RpAuthService(
      store,
      fakeClient({
        verify: async () => {
          throw new Error("bad sig");
        },
      }),
      3600,
    );
    expect((await svc.resolve("rps1")).status).toBe("expired");
  });

  /**
   * 一次页面加载并发十几个请求，它们会同时落进过期前 60 秒的窗口。
   * 没有单飞，这十几个请求就拿同一枚 refresh token 各自去换 ——
   * IdP 那边一个赢、其余全部被判为重放，而重放的处置是吊销。
   */
  it("并发 resolve 只打一次 refresh（单飞）", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rp1", session({ accessExpiresAt: now() + 10 }), 3600);

    let calls = 0;
    const client = fakeClient({
      refresh: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return {
          idToken: "id2",
          accessToken: "acc2",
          refreshToken: "ref2",
          accessExpiresAt: now() + 3600,
        } as OidcTokenSet;
      },
    });
    const svc = new RpAuthService(store, client, 3600);

    const outs = await Promise.all([
      svc.resolve("rp1"),
      svc.resolve("rp1"),
      svc.resolve("rp1"),
    ]);

    expect(calls).toBe(1);
    expect(outs.every((o) => o.status === "ok")).toBe(true);
  });

  /**
   * 跨进程并发：别的实例刚换成功并把新令牌写回存储。
   * 刷新被拒不等于会话没了 —— 先回读一次，存储里的过期时刻向前走了就用那份。
   */
  it("刷新被拒但存储里已被别人刷新过：不销毁，用新的那份", async () => {
    const redis = fakeRedis();
    const store = new RpSessionStore(redis, "console");
    await store.create("rp1", session({ accessExpiresAt: now() + 10 }), 3600);

    const client = fakeClient({
      refresh: async () => {
        // 模拟另一个进程抢先换好并写回
        await store.update(
          "rp1",
          session({ accessToken: "acc-other", accessExpiresAt: now() + 3600 }),
          3600,
        );
        throw new Error("invalid_grant");
      },
    });
    const svc = new RpAuthService(store, client, 3600);

    const out = await svc.resolve("rp1");
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.accessToken).toBe("acc-other");
    expect(await store.get("rp1")).not.toBeNull();
  });

  it("刷新被拒且存储没有更新：才销毁会话", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rp1", session({ accessExpiresAt: now() + 10 }), 3600);

    const client = fakeClient({
      refresh: async () => {
        throw new Error("invalid_grant");
      },
    });
    const svc = new RpAuthService(store, client, 3600);

    expect((await svc.resolve("rp1")).status).toBe("expired");
    expect(await store.get("rp1")).toBeNull();
  });
});

// ============================================================================
// Revocation boundaries during asynchronous identity resolution
// ============================================================================

describe("RP revocation fencing", () => {
  it.each(["local", "backchannel"])(
    "does not resurrect a session revoked by %s logout during refresh",
    async (mode) => {
      const store = new RpSessionStore(fakeRedis(), "console");
      await store.create("rp1", session({ accessExpiresAt: now() + 5 }), 3600);
      let release!: (value: OidcTokenSet) => void;
      let started!: () => void;
      const refreshing = new Promise<void>((resolve) => {
        started = resolve;
      });
      const svc = new RpAuthService(
        store,
        fakeClient({
          refresh: async () => {
            started();
            return new Promise<OidcTokenSet>((resolve) => {
              release = resolve;
            });
          },
        }),
        3600,
      );
      const pending = svc.resolve("rp1");
      await refreshing;
      if (mode === "local") await store.destroy("rp1");
      else await store.destroyBySid("sidA");
      release(session({ accessToken: "rotated", refreshToken: "rotated-ref" }));
      expect(await pending).toEqual({ status: "expired" });
      expect(await store.get("rp1")).toBeNull();
    },
  );

  it("rejects verified identity if logout occurs during token verification", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rp1", session(), 3600);
    const svc = new RpAuthService(
      store,
      fakeClient({
        verify: async () => {
          await store.destroyBySid("sidA");
          return { sub: "usr_1" };
        },
      }),
      3600,
    );
    expect(await svc.resolve("rp1")).toEqual({ status: "expired" });
  });

  it("does not overwrite a replacement identity after delayed refresh", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rp1", session({ accessExpiresAt: now() + 5 }), 3600);
    const replacement = session({
      sid: "sidB",
      sub: "usr_2",
      accessToken: "other-user",
    });
    const svc = new RpAuthService(
      store,
      fakeClient({
        refresh: async () => {
          await store.destroy("rp1");
          await store.create("rp1", replacement, 3600);
          return session({ accessToken: "late-old-user" });
        },
      }),
      3600,
    );
    expect(await svc.resolve("rp1")).toEqual({ status: "expired" });
    expect(await store.get("rp1")).toEqual(replacement);
  });

  it("uses the concurrent rotation winner instead of overwriting it", async () => {
    const store = new RpSessionStore(fakeRedis(), "console");
    await store.create("rp1", session({ accessExpiresAt: now() + 5 }), 3600);
    const winner = session({
      accessToken: "winner",
      refreshToken: "winner-ref",
    });
    const svc = new RpAuthService(
      store,
      fakeClient({
        refresh: async () => {
          await store.update("rp1", winner, 3600, "ref");
          return session({
            accessToken: "late-loser",
            refreshToken: "loser-ref",
          });
        },
      }),
      3600,
    );
    const outcome = await svc.resolve("rp1");
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.accessToken).toBe("winner");
    expect(await store.get("rp1")).toEqual(winner);
  });
});

// ============================================================================
// Failed refresh must not delete a replacement identity
// ============================================================================

it("keeps a replacement session when an old identity refresh is rejected", async () => {
  const store = new RpSessionStore(fakeRedis(), "console");
  await store.create("rp1", session({ accessExpiresAt: now() + 5 }), 3600);
  const replacement = session({
    sid: "sidB",
    sub: "usr_2",
    accessToken: "new-user",
  });
  const svc = new RpAuthService(
    store,
    fakeClient({
      refresh: async () => {
        await store.destroy("rp1");
        await store.create("rp1", replacement, 3600);
        throw new Error("invalid_grant");
      },
    }),
    3600,
  );
  expect(await svc.resolve("rp1")).toEqual({ status: "expired" });
  expect(await store.get("rp1")).toEqual(replacement);
});
