/**
 * complete-profile.spec.ts — 注册补齐的落库顺序（owner 2026-09-08）。
 *
 * ── 钉的是哪一条 ──
 * `profile_completed_at` 是「三项都落了」的凭据，登录路径靠它决定要不要把人引去补齐页。
 * 所以**早标一步就是 bug**：用户名改成功、邮箱撞了唯一键抛 409，如果这时已经标了完成，
 * 那个人就永远不会再被要求补邮箱了——而邮箱必填的整个理由（账单 / 到期提醒 / 退款进度
 * 默认都走邮件）也就落空了，且不报任何错。
 *
 * 这类缺陷不会在构建或类型上现形，只会在几周后表现为「有人收不到账单邮件」。
 */
import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountService } from "./account.service";
import { MockUserRepository } from "../repository/mock-user.repository";

function makeService(repo: MockUserRepository): AccountService {
  // 补齐这条路径只碰仓储；密码哈希器用不到，给空壳即可。
  return new AccountService(repo as never, {} as never);
}

describe("AccountService.completeProfile", () => {
  let repo: MockUserRepository;
  let service: AccountService;
  let userId: string;

  beforeEach(async () => {
    repo = new MockUserRepository();
    service = makeService(repo);
    const user = await repo.createUser({
      phone: "13900000001",
      phoneVerified: true,
    } as never);
    userId = user.id;
  });

  it("新账号一开始是「未完成」", async () => {
    expect(await service.isProfileCompleted(userId)).toBe(false);
  });

  it("三项都落库之后才标记完成", async () => {
    await service.completeProfile(userId, {
      account: "alice",
      displayName: "爱丽丝",
      email: "alice@example.com",
    });
    expect(await service.isProfileCompleted(userId)).toBe(true);
    const user = await repo.getUserById(userId);
    expect(user?.account).toBe("alice");
    expect(user?.email).toBe("alice@example.com");
    expect(user?.name).toBe("爱丽丝");
  });

  it("用户名撞了 → 抛 409，且**不能**标成已完成", async () => {
    const other = await repo.createUser({
      phone: "13900000002",
      phoneVerified: true,
    } as never);
    await repo.changeAccount(other.id, "taken");

    await expect(
      service.completeProfile(userId, {
        account: "taken",
        displayName: "爱丽丝",
        email: "alice@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await service.isProfileCompleted(userId)).toBe(false);
  });

  it("邮箱写入失败 → 不能标成已完成（早标一步 = 那个人永远补不上邮箱）", async () => {
    const fail = vi
      .spyOn(repo, "updateProfile")
      .mockRejectedValueOnce(new ConflictException("email already in use"));

    await expect(
      service.completeProfile(userId, {
        account: "alice",
        displayName: "爱丽丝",
        email: "taken@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await service.isProfileCompleted(userId)).toBe(false);
    fail.mockRestore();
  });

  it("查不到的用户按「已完成」处理——不把不存在的人引去补齐页", async () => {
    expect(
      await service.isProfileCompleted("00000000-0000-0000-0000-000000000000"),
    ).toBe(true);
  });
});
