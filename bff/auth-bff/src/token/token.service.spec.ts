/**
 * token.service.spec.ts —— refresh 令牌的轮换、并发与重放。
 *
 * 这三种行为此前**零测试**，而它们正是 2026-09-30 那次生产事故的现场：
 * 两个并发请求拿同一枚令牌去换，输的那个调 `revokeSession(sessionId)`，
 * 而那条 SQL 连赢家刚插入的新令牌一起收 ⇒ 同一用户所有门户、所有标签页被登出。
 *
 * 所以这里钉的不是「函数跑得通」，是三条**判据**：
 *   ① CAS 落败绝不吊销任何东西；
 *   ② 宽限窗口内的重放只拒这一次；
 *   ③ 真正的重放只吊这个 client 的家族，不碰整条会话。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { TokenService } from "./token.service";
import type {
  RefreshInsert,
  RefreshRecord,
  RefreshStore,
} from "./refresh-token.repository";

const SESSION = "sess-1";
const CLIENT = "console";

interface RevokeCall {
  sessionId: string;
  /** 本仓开了 exactOptionalPropertyTypes，可选属性要显式带上 undefined。 */
  clientId?: string | undefined;
}

/** 一个可编排的假存储：记录每一次 revoke 的**范围**，那才是本次要断言的东西。 */
function makeStore(rec: RefreshRecord | null) {
  const revokes: RevokeCall[] = [];
  const inserted: RefreshInsert[] = [];
  let childIssuedAt: Date | null = null;
  let casWins = true;

  const store: RefreshStore = {
    async insert(input) {
      inserted.push(input);
      return "new-id";
    },
    async findByHash() {
      return rec;
    },
    async markRotated() {
      return casWins;
    },
    async revokeSession(sessionId, clientId) {
      revokes.push({ sessionId, clientId });
    },
    async findActiveChildIssuedAt() {
      return childIssuedAt;
    },
  };

  return {
    store,
    revokes,
    inserted,
    setChildIssuedAt(d: Date | null) {
      childIssuedAt = d;
    },
    setCasWins(v: boolean) {
      casWins = v;
    },
  };
}

function emptyStore(): RefreshStore {
  return {
    async insert() {
      return "x";
    },
    async findByHash() {
      return null;
    },
    async markRotated() {
      return false;
    },
    async revokeSession() {},
    async findActiveChildIssuedAt() {
      return null;
    },
  };
}

function record(status: string): RefreshRecord {
  return {
    id: "tok-1",
    userId: "user-1",
    sessionId: SESSION,
    clientId: CLIENT,
    status,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

function service(store: RefreshStore) {
  const keys = {} as never;
  const config = { auth: { OIDC_REFRESH_TTL: 2_592_000 } } as never;
  return new TokenService(keys, store, emptyStore(), config);
}

describe("TokenService.refresh 轮换", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("正常轮换：签发后继，一次都不吊销", async () => {
    const f = makeStore(record("active"));
    const out = await service(f.store).rotateRefreshToken("raw");

    expect(out.sessionId).toBe(SESSION);
    expect(out.clientId).toBe(CLIENT);
    expect(f.inserted).toHaveLength(1);
    expect(f.inserted[0]!.rotatedFrom).toBe("tok-1");
    expect(f.revokes).toEqual([]);
  });

  /**
   * 这一条是事故的直接成因。CAS 落败按定义就是「另一个请求刚刚赢了」——
   * 是并发，不是入侵。旧写法在这里吊销整条会话，把赢家刚签发的新票一起收掉。
   */
  it("CAS 落败：只拒这一次，绝不吊销", async () => {
    const f = makeStore(record("active"));
    f.setCasWins(false);

    await expect(
      service(f.store).rotateRefreshToken("raw"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.revokes).toEqual([]);
    expect(f.inserted).toEqual([]);
  });

  it("宽限窗口内：子令牌刚生成 ⇒ 判为并发，只拒这一次", async () => {
    const f = makeStore(record("rotated"));
    f.setChildIssuedAt(new Date(Date.now() - 500));

    await expect(
      service(f.store).rotateRefreshToken("raw"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.revokes).toEqual([]);
  });

  /**
   * 真正的重放才吊销，而且**只吊这个 client 的家族**。
   * 不传 clientId 的那一档（整条会话）只留给真登出与管理员强制下线。
   */
  it("窗口外的重放：吊销，但只吊这个 client 的家族", async () => {
    const f = makeStore(record("rotated"));
    f.setChildIssuedAt(new Date(Date.now() - 5 * 60_000));

    await expect(
      service(f.store).rotateRefreshToken("raw"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.revokes).toEqual([{ sessionId: SESSION, clientId: CLIENT }]);
  });

  it("没有子令牌的重放：同样只吊这个 client 的家族", async () => {
    const f = makeStore(record("revoked"));
    f.setChildIssuedAt(null);

    await expect(
      service(f.store).rotateRefreshToken("raw"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.revokes).toEqual([{ sessionId: SESSION, clientId: CLIENT }]);
  });

  it("过期令牌：拒绝，且不吊销（过期不是入侵）", async () => {
    const rec = record("active");
    rec.expiresAt = new Date(Date.now() - 1000);
    const f = makeStore(rec);

    await expect(
      service(f.store).rotateRefreshToken("raw"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.revokes).toEqual([]);
  });

  /**
   * 两个并发调用共用一份存储：第一个赢，第二个 CAS 落败。
   * 断言的是**赢家的新令牌还在**——旧写法下它会被输家连带吊销。
   */
  it("两个并发消费：赢家的新令牌不得被输家连累", async () => {
    const f = makeStore(record("active"));
    const svc = service(f.store);

    const located = await svc.inspectRefreshToken("raw");
    const first = await svc.consumeRefreshToken(located);
    expect(first.refreshToken).toBeTruthy();

    f.setCasWins(false);
    await expect(svc.consumeRefreshToken(located)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(f.inserted).toHaveLength(1);
    expect(f.revokes).toEqual([]);
  });
});
