/**
 * account-rules.spec.ts — 用户名格式与改名冷却。
 *
 * ── 为什么这块值得测 ──
 * 用户名规则**在三个文件里各写了一遍**（后端 account.service、console 的
 * onboarding 页、accounts 的注册补齐页），而它们必须逐字一致。
 *
 * 2026-09-08 就漂过一次：accounts 那份写成 `{3,31}`（4–32 位），注释还写着
 * 「与后端同口径」——填 3 位的被前端拦下（后端本来接受），填 25 位的前端放行、
 * 后端回 400。**两种都不报错**，只表现为「这个用户名怎么不让用」。
 * 三处一致由 scripts/guardrails/check-account-rules.mjs 守着；这里钉住规则本身。
 *
 * 改名冷却同理：判松了能被人反复改名（用户名是登录句柄，频繁变更让账号难以追溯）；
 * 判紧了正常用户改不了名，而错误信息里那个「下次可改时间」算错了没人会发现。
 */
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountService,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  assertValidAccount,
} from "./account.service";
import { MockUserRepository } from "../repository/mock-user.repository";

describe("assertValidAccount — 用户名格式", () => {
  it.each(["abc", "a_1", "Zhang_San_2026", "a".repeat(24)])("合法：%s", (v) => {
    expect(() => assertValidAccount(v)).not.toThrow();
  });

  it("边界：3 位收、2 位拒；24 位收、25 位拒", () => {
    expect(() => assertValidAccount("abc")).not.toThrow();
    expect(() => assertValidAccount("ab")).toThrow(BadRequestException);
    expect(() => assertValidAccount("a".repeat(24))).not.toThrow();
    expect(() => assertValidAccount("a".repeat(25))).toThrow(
      BadRequestException,
    );
  });

  it("必须字母开头——数字或下划线开头都拒", () => {
    // 下划线开头这条尤其要紧：建号时发的默认句柄就是 `_{user_no}`，
    // 放行它等于让人把默认值当正式用户名提交，补齐门也就形同虚设。
    for (const v of ["1abc", "_abc", "_10000123"]) {
      expect(() => assertValidAccount(v), v).toThrow(BadRequestException);
    }
  });

  it("只允许字母数字下划线——连字符、点、空格、中文都拒", () => {
    for (const v of ["a-bc", "a.bc", "a bc", "张三abc", "a@bc", "abc!"]) {
      expect(() => assertValidAccount(v), v).toThrow(BadRequestException);
    }
  });

  it("空串与纯空白拒", () => {
    for (const v of ["", "   "]) {
      expect(() => assertValidAccount(v), JSON.stringify(v)).toThrow(
        BadRequestException,
      );
    }
  });
});

describe("changeUsername — 改名冷却", () => {
  let repo: MockUserRepository;
  let svc: AccountService;
  let userId: string;

  beforeEach(async () => {
    repo = new MockUserRepository();
    svc = new AccountService(repo as never, {} as never);
    const u = await repo.createUser({
      phone: "13900000001",
      phoneVerified: true,
    } as never);
    userId = u.id;
  });

  it("首次改名放行（accountChangedAt 为空）", async () => {
    // 注册补齐正是首次改名——这条要是拒了，新用户根本完成不了注册。
    const out = await svc.changeUsername(userId, "alice");
    expect(out?.account).toBe("alice");
  });

  it("格式不合法先被拦下（不落库）", async () => {
    await expect(svc.changeUsername(userId, "_123")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await repo.getUserById(userId))?.account).not.toBe("_123");
  });

  it("改成同一个名字是 no-op，不触发冷却", async () => {
    await svc.changeUsername(userId, "alice");
    const again = await svc.changeUsername(userId, "alice");
    expect(again?.account).toBe("alice");
  });

  it("大小写不同视为同一个名字（no-op，不占用冷却名额）", async () => {
    await svc.changeUsername(userId, "alice");
    const out = await svc.changeUsername(userId, "ALICE");
    expect(out?.account).toBe("alice");
  });

  it("查不到的用户返回 null，不抛", async () => {
    await expect(
      svc.changeUsername("00000000-0000-0000-0000-000000000000", "bob"),
    ).resolves.toBeNull();
  });

  it("冷却天数是 30——错误信息里的天数要与实际判据同源", async () => {
    // 常见坏法：文案写死 30、判据用别的常量，改一处忘另一处，
    // 用户看到的「30 天后可改」与实际能改的时间对不上。
    expect(USERNAME_CHANGE_COOLDOWN_DAYS).toBe(30);
  });
});
