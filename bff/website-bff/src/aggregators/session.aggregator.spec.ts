import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { SessionAggregator } from "./session.aggregator";

// /api/me/profile 的字段映射契约(2026-08-30 去 mock):
//   1. bio / timezone / language 来自 UserView(account.user_profiles 真列),不再是字面 null;
//   2. profileUpdatedAt 读 account.user_profiles.updated_at:无行 → null,读失败 → null
//      (时间戳只是信息性的,不能拖垮整个读取);
//   3. 更新时 bio / timezone / language 随 displayName / email 一起进 AccountService.updateProfile
//      的补丁;请求体里没出现的字段不进补丁(undefined ≠ 清空);
//   4. 响应里没有 headline —— 账户 schema 没有这一列。

const USER = {
  id: "u-1",
  account: "alice",
  email: "alice@example.test",
  phone: "13800000000",
  name: "Alice",
  status: "active",
  avatarHash: null,
  bio: "hello",
  timezone: "Asia/Shanghai",
  language: "zh-CN",
};

function makeAggregator(
  opts: { profileRows?: unknown[]; poolError?: boolean } = {},
) {
  const account = {
    getUserById: vi.fn().mockResolvedValue(USER),
    updateProfile: vi.fn().mockResolvedValue(USER),
  };
  const active = { resolveActiveContext: vi.fn().mockResolvedValue(null) };
  const config = { auth: { OIDC_ISSUER: "https://accounts.example.test/" } };
  const query = opts.poolError
    ? vi.fn().mockRejectedValue(new Error("pool down"))
    : vi.fn().mockResolvedValue({ rows: opts.profileRows ?? [] });
  const aggregator = new SessionAggregator(
    account as never,
    active as never,
    config as never,
    { query } as unknown as Pool,
  );
  return { aggregator, account, query };
}

describe("SessionAggregator profile mapping", () => {
  it("maps bio / timezone / language / updated_at from the real profile columns", async () => {
    const updatedAt = new Date("2026-08-30T01:02:03.000Z");
    const { aggregator, query } = makeAggregator({
      profileRows: [{ updated_at: updatedAt }],
    });
    const profile = await aggregator.getCurrentUserProfile("u-1");

    expect(profile).toMatchObject({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      bio: "hello",
      timezone: "Asia/Shanghai",
      language: "zh-CN",
      profileUpdatedAt: "2026-08-30T01:02:03.000Z",
    });
    expect(profile && "headline" in profile).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("updated_at"), [
      "u-1",
    ]);
  });

  it("returns null profileUpdatedAt when the user has no profile row", async () => {
    const { aggregator } = makeAggregator({ profileRows: [] });
    const profile = await aggregator.getCurrentUserProfile("u-1");
    expect(profile?.profileUpdatedAt).toBeNull();
  });

  it("degrades profileUpdatedAt to null when the pool read fails", async () => {
    const { aggregator } = makeAggregator({ poolError: true });
    const profile = await aggregator.getCurrentUserProfile("u-1");
    expect(profile?.bio).toBe("hello");
    expect(profile?.profileUpdatedAt).toBeNull();
  });

  it("forwards bio / timezone / language alongside displayName in the update patch", async () => {
    const { aggregator, account } = makeAggregator();
    await aggregator.updateCurrentUserProfile("u-1", {
      displayName: "Alice B",
      bio: "new bio",
      timezone: "UTC",
      language: "en-US",
    });
    // email 没在请求体里 → 不进补丁(留给 coalesce 保持原值)。
    expect(account.updateProfile).toHaveBeenCalledWith("u-1", {
      name: "Alice B",
      bio: "new bio",
      timezone: "UTC",
      language: "en-US",
    });
  });

  it("does not touch the account service when only unsupported fields are sent", async () => {
    const { aggregator, account } = makeAggregator();
    const profile = await aggregator.updateCurrentUserProfile("u-1", {
      username: "renamed",
    });
    expect(account.updateProfile).not.toHaveBeenCalled();
    expect(profile?.username).toBe("alice");
  });
});
