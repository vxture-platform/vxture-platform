/**
 * profile-timezone.spec.ts — 资料里的时区只许存 canonical IANA 名(owner 裁定 4,2026-10-04)。
 *
 * ── 为什么这块值得测 ──
 * 用量趋势的 day 档按这个值把小时表重切成用户的本地日。此前任何字符串都能存进去
 * (profile.dto 只是 `string | null`,仓储 coalesce 直接落库),读侧只能在每次请求里
 * 兜底成「认不出,按 UTC」——写进去的那一刻才是该拦的地方。
 *
 * 校验长在**域服务**而不是 BFF:console-bff 与 website-bff 两处都写这个字段,
 * 只守一边等于给另一边留门。判据与读侧同一个(isIanaTimeZone,经 core-utils 转出口)。
 */
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountService, assertValidTimezone } from "./account.service";
import { MockUserRepository } from "../repository/mock-user.repository";

describe("assertValidTimezone — 时区格式", () => {
  it("canonical IANA 名与 UTC 通过", () => {
    for (const z of [
      "Asia/Shanghai",
      "Europe/Berlin",
      "America/New_York",
      "UTC",
    ]) {
      expect(() => assertValidTimezone(z)).not.toThrow();
    }
  });

  it("null / undefined(不改)与空串(清空)都放行——它们不是时区值", () => {
    expect(() => assertValidTimezone(null)).not.toThrow();
    expect(() => assertValidTimezone(undefined)).not.toThrow();
    expect(() => assertValidTimezone("")).not.toThrow();
  });

  it("随便一串、大小写变体、偏移写法都 400 invalid_timezone", () => {
    for (const z of [
      "Mars/Olympus",
      "asia/shanghai",
      "GMT+8",
      "+08:00",
      "Beijing",
    ]) {
      let caught: unknown;
      try {
        assertValidTimezone(z);
      } catch (e) {
        caught = e;
      }
      expect(caught, z).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toBe("invalid_timezone");
    }
  });
});

describe("AccountService.updateProfile · timezone", () => {
  let repo: MockUserRepository;
  let service: AccountService;
  let userId: string;

  beforeEach(async () => {
    repo = new MockUserRepository();
    // 这条路径只碰仓储;密码哈希器用不到,给空壳即可(与 complete-profile.spec 同法)。
    service = new AccountService(repo as never, {} as never);
    const user = await repo.createUser({
      phone: "13900000003",
      phoneVerified: true,
    } as never);
    userId = user.id;
  });

  it("合法时区落库", async () => {
    const view = await service.updateProfile(userId, {
      timezone: "Europe/Berlin",
    });
    expect(view?.timezone).toBe("Europe/Berlin");
    expect((await repo.getUserById(userId))?.timezone).toBe("Europe/Berlin");
  });

  it("非法时区 → 400,且**不落库**(原值不变)", async () => {
    await service.updateProfile(userId, { timezone: "Asia/Shanghai" });
    await expect(
      service.updateProfile(userId, { timezone: "Mars/Olympus" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await repo.getUserById(userId))?.timezone).toBe("Asia/Shanghai");
  });

  it("只改别的字段、不带时区 → 不受影响", async () => {
    await service.updateProfile(userId, { timezone: "Asia/Shanghai" });
    const view = await service.updateProfile(userId, { bio: "hello" });
    expect(view?.bio).toBe("hello");
    expect(view?.timezone).toBe("Asia/Shanghai");
  });
});
