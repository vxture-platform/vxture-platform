/**
 * account-admin-reason.spec.ts —— 运营处置三个端点的「原因必填」与它的去处（2026-09-29）。
 *
 * ── 这条用例钉的是什么 ──
 * owner 裁定 3：运营锁定 / 解锁 / 强制下线的「原因」改**必填**，并**照搬给客户**。
 * 在这之前这个字段走到 IdP 就没了：admin-bff 的 S2S 请求体一直送着 `{ actorOperatorId,
 * reason }`，而本路由**连 `@Body()` 都不收**。于是三条客户通知里那句「原因：…」没有来源，
 * 而弹窗上却写着「将写入审计日志」。
 *
 * ── 为什么值得一条用例 ──
 * 「参数被丢掉」不报错。类型过、编译过、端点回 200、运营看到「已停用」，只有客户那边收到
 * 一条没有原因的通知——或者（按 securityNotice 的硬门）一条都收不到。所以这里逐个端点断言
 * 两件事：空原因当场 400、而填了的那一句**原样**落到服务层的第二个实参上。
 */
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AccountAdminInternalRouter } from "./account-admin-internal.router";

function build() {
  const accounts = {
    adminDisableAccount: vi
      .fn()
      .mockResolvedValue({ user: { status: "disabled" }, revoked: 2 }),
    adminEnableAccount: vi.fn().mockResolvedValue({ status: "active" }),
    adminForceLogout: vi.fn().mockResolvedValue({ revoked: 3 }),
  };
  const router = new AccountAdminInternalRouter(
    accounts as unknown as ConstructorParameters<
      typeof AccountAdminInternalRouter
    >[0],
  );
  return { router, accounts };
}

const USER_ID = "11111111-2222-3333-4444-555555555555";
const REASON = "风控命中：同一设备 24 小时内 37 次失败登录";

describe("运营处置：原因必填", () => {
  it("三个端点都在缺原因时 400（不是静默继续）", async () => {
    const { router, accounts } = build();
    for (const body of [
      undefined,
      {},
      { reason: "" },
      { reason: "   " },
      { actorOperatorId: "opr-1" },
    ]) {
      await expect(
        router.disable(USER_ID, body as { reason?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        router.enable(USER_ID, body as { reason?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        router.revokeSessions(USER_ID, body as { reason?: string }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    /* 400 必须发生在动手**之前**：写了一半再拒绝，账号会停在一个运营没看见的状态。 */
    expect(accounts.adminDisableAccount).not.toHaveBeenCalled();
    expect(accounts.adminEnableAccount).not.toHaveBeenCalled();
    expect(accounts.adminForceLogout).not.toHaveBeenCalled();
  });

  it("填了的那一句原样传给服务层（不改写、不截断、不加前缀）", async () => {
    const { router, accounts } = build();
    await router.disable(USER_ID, { actorOperatorId: "opr-1", reason: REASON });
    await router.enable(USER_ID, { reason: REASON });
    await router.revokeSessions(USER_ID, { reason: REASON });
    expect(accounts.adminDisableAccount).toHaveBeenCalledWith(USER_ID, REASON);
    expect(accounts.adminEnableAccount).toHaveBeenCalledWith(USER_ID, REASON);
    expect(accounts.adminForceLogout).toHaveBeenCalledWith(USER_ID, REASON);
  });

  it("首尾空白去掉，中间原样（运营在弹窗里粘贴常带换行）", async () => {
    const { router, accounts } = build();
    await router.disable(USER_ID, { reason: `  ${REASON}\n` });
    expect(accounts.adminDisableAccount).toHaveBeenCalledWith(USER_ID, REASON);
  });

  it("响应体不变：装上这道门没有改端点的契约", async () => {
    const { router } = build();
    expect(await router.disable(USER_ID, { reason: REASON })).toEqual({
      ok: true,
      status: "disabled",
      revoked: 2,
    });
    expect(await router.enable(USER_ID, { reason: REASON })).toEqual({
      ok: true,
      status: "active",
    });
    expect(await router.revokeSessions(USER_ID, { reason: REASON })).toEqual({
      ok: true,
      revoked: 3,
    });
  });
});
