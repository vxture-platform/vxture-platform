/**
 * security-notifications.spec.ts —— 账号安全事件的组装与「未见过的设备」判据（2026-09-29）。
 *
 * 钉的是四件容易静默错掉的事：
 *   ① 去重锚带时刻、不含 uuid —— 少了时刻，客户第二次改密码会被收件箱的唯一键压掉；
 *      锚里混进 uuid，它会被收件箱读路径原样投影给浏览器。
 *   ② 参数名 —— 写错一个名字不报错，`interpolate` 把它换成空串，客户读到一句带洞的话。
 *   ③ 「什么时候刻意不发」—— 首次登录、认不出的设备、见过的设备各有各的理由，而这三条一旦
 *      写反，症状是「这条通知看起来装好了却永远不响」或者「每次登录都响」。
 *   ④ 点击落点 —— 见下面那一段：它此前是被一个**手抄的期望值**放过去的。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTOR_PARAM,
  PROVIDER_PARAM,
  SECURITY_ACTORS,
  SECURITY_NOTIFICATION_TEMPLATES,
  SECURITY_REFERENCE_TYPE,
  securityEventOf,
  securityReferenceId,
} from "./customer-notifier";
import {
  SECURITY_LINK,
  UNSEEN_DEVICE_LOOKBACK_DAYS,
  deviceFingerprint,
  isUnseenDevice,
  securityNotice,
} from "./security-notifications";

const AT = new Date("2026-09-29T12:14:32.789Z");
/** 换走之前那个邮箱地址：只有 `account.email_changed_old` 要它，且缺了就不发。 */
const OLD_EMAIL = "old.address@example.com";
const BASE = {
  accountId: "11111111-2222-3333-4444-555555555555",
  userNo: "1234567890",
  personalTenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  occurredAt: AT,
} as const;

/**
 * 十四条都发得出去所需要的全套事实。逐条穷举时用它：少一项就会有几条落在 gap 上，
 * 而那时 `expect(ok).toBe(true)` 报的是「组装错了」，把真正在测的那件事掩住。
 */
const COMPLETE = {
  ...BASE,
  reason: "风控命中",
  actor: SECURITY_ACTORS.operator,
  provider: "google",
  emailTo: OLD_EMAIL,
} as const;

// ── console 的两份配置：路由表与侧栏导航 ────────────────────────────────────
//
// 为什么读文本而不是 import：`no-service-to-upper` 那条边界规则不许 services 依赖
// portals，而这里要的本来也不是那个模块——要的是「console 的路由表里到底有没有这个
// 地址」。读文本只发生在**跑测试的时候**，运行时一个依赖都没加。
//
// 为什么非得对账不可：上一版那个 `/account/profile` 是被一个手抄的期望值放过去的。
// 期望值和被测的常量一起错，于是它永远相等，而十四条安全通知每一条点开都是 404。
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CONSOLE_CONFIG = join(REPO_ROOT, "portals", "console", "src", "config");
const CONSOLE_APP = join(
  REPO_ROOT,
  "portals",
  "console",
  "src",
  "app",
  "[locale]",
  "(console)",
);

function matches(file: string, re: RegExp): string[] {
  const text = readFileSync(join(CONSOLE_CONFIG, file), "utf8");
  return [...text.matchAll(re)]
    .map((m) => m[1])
    .filter((v): v is string => Boolean(v));
}

/** `routes.ts` 的 `routeLabels`：console 认得的每一条应用内路径。 */
const routeTablePaths = matches("routes.ts", /\["(\/[^"]*)",/g);
/** `navigation.ts` 的每一个 `href`：侧栏真的指得到的那些。 */
const navigationHrefs = matches("navigation.ts", /href:\s*"(\/[^"]*)"/g);

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
/** 同一台机器、Chrome 自升了一个大版本：指纹必须不变，否则每月一条假警报。 */
const CHROME_WIN_NEXT = CHROME_WIN.replace("Chrome/141.0", "Chrome/142.0");

describe("去重锚", () => {
  it("形状 = sec:{可视用户号}:{事件名}:{ISO 时刻}", () => {
    expect(securityReferenceId(BASE.userNo, "account.password_reset", AT)).toBe(
      "sec:1234567890:password_reset:2026-09-29T12:14:32.789Z",
    );
  });

  it("带时刻：同一条事件发生两次，两个锚不同（否则第二次被唯一键压掉）", () => {
    const later = new Date(AT.getTime() + 1000);
    expect(
      securityReferenceId(BASE.userNo, "account.password_changed", AT),
    ).not.toBe(
      securityReferenceId(BASE.userNo, "account.password_changed", later),
    );
  });

  it("事件名从模板码算，不另写一张表", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      expect(code.startsWith("account.")).toBe(true);
      expect(securityReferenceId(BASE.userNo, code, AT).split(":")[2]).toBe(
        securityEventOf(code),
      );
    }
  });

  it("用户号形状不对（uuid / 空 / 带字母）一律退成 unknown，锚里绝不出现那个值", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    for (const bad of [uuid, "", "   ", "abc123", null, undefined]) {
      const id = securityReferenceId(bad, "account.locked", AT);
      expect(id.startsWith("sec:unknown:")).toBe(true);
    }
    expect(securityReferenceId(uuid, "account.locked", AT)).not.toContain(uuid);
  });

  it("十四条的锚都在 reference_id 的 varchar(128) 之内（按真实码表算）", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      expect(securityReferenceId(BASE.userNo, code, AT).length).toBeLessThan(
        128,
      );
    }
  });
});

describe("securityNotice 组装", () => {
  it("occurredAt 带秒带时区，且是字符串不是 Date", () => {
    const outcome = securityNotice("account.phone_changed", BASE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.params.occurredAt).toBe("2026-09-29 20:14:32 (UTC+8)");
    expect(typeof outcome.input.params.occurredAt).toBe("string");
  });

  it("引用类型是 security，收件人只有本人，租户是个人租户", () => {
    const outcome = securityNotice("account.phone_changed", BASE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.reference.type).toBe(SECURITY_REFERENCE_TYPE);
    expect(outcome.input.exactRecipients).toEqual([BASE.accountId]);
    expect(outcome.input.tenantId).toBe(BASE.personalTenantId);
    /* 落点的值对不对由下面「点击落点」那一组按 console 的配置判；这里只钉它确实被带上。 */
    expect(outcome.input.link).toBe(SECURITY_LINK);
  });

  it("没有个人租户 ⇒ 不发并点名（收件箱的 tenant_id 是 NOT NULL）", () => {
    const outcome = securityNotice("account.phone_changed", {
      ...BASE,
      personalTenantId: null,
    });
    expect(outcome).toEqual({ ok: false, gap: "no_personal_tenant" });
  });

  it("运营处置三条缺原因 ⇒ 不发并点名（绝不自己编一句）", () => {
    for (const code of [
      "account.locked",
      "account.unlocked",
      "account.sessions_ended_by_operator",
    ] as const) {
      expect(securityNotice(code, BASE)).toEqual({
        ok: false,
        gap: "no_reason",
      });
      expect(securityNotice(code, { ...BASE, reason: "   " })).toEqual({
        ok: false,
        gap: "no_reason",
      });
    }
  });

  it("运营填的原因原样进参数（不改写、不截断、不加前缀）", () => {
    const reason = "风控命中：同一设备 24 小时内 37 次失败登录";
    const outcome = securityNotice("account.locked", { ...BASE, reason });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.params.reason).toBe(reason);
  });

  it("操作者与第三方放**码**不放词，参数名走权威那侧同名的常量", () => {
    const changed = securityNotice("account.password_changed", {
      ...BASE,
      actor: SECURITY_ACTORS.tenantAdmin,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.input.params[ACTOR_PARAM]).toBe("tenant_admin");

    const linked = securityNotice("account.identity_linked", {
      ...BASE,
      provider: "feishu",
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.input.params[PROVIDER_PARAM]).toBe("feishu");
  });

  it("缺操作者 / 第三方码照发（模板层会回落成一句实话），只是不带那个参数", () => {
    const outcome = securityNotice("account.password_changed", BASE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.params[ACTOR_PARAM]).toBeUndefined();
  });

  it("任何一条的参数里都不出现账号 uuid", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      const outcome = securityNotice(code, COMPLETE);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      const serialised = JSON.stringify({
        params: outcome.input.params,
        reference: outcome.input.reference,
      });
      expect(serialised).not.toContain(BASE.accountId);
    }
  });
});

describe("点击落点", () => {
  it("是 console 路由表里真有的那一条（按 routes.ts 对账，不照抄字符串）", () => {
    /* 先证这条判据不是空的：正则没命中时空数组 `not.toContain` 恒过，那种绿是假的。 */
    expect(routeTablePaths.length).toBeGreaterThan(10);
    expect(routeTablePaths).toContain(SECURITY_LINK);
  });

  it("侧栏导航也指得到它（是进得去的页，不是一条孤路由）", () => {
    expect(navigationHrefs.length).toBeGreaterThan(3);
    expect(navigationHrefs).toContain(SECURITY_LINK);
  });

  it("app 路由下有对应的真页面", () => {
    const dir = join(CONSOLE_APP, ...SECURITY_LINK.split("/").filter(Boolean));
    expect(existsSync(join(dir, "page.tsx"))).toBe(true);
  });

  it("上一版那个值不是路由：console 里没有 /account 这一段", () => {
    expect(existsSync(join(CONSOLE_APP, "account"))).toBe(false);
    expect(routeTablePaths).not.toContain("/account/profile");
  });

  it("十四条共用同一个落点（一处定义，没有第二份副本）", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      const outcome = securityNotice(code, COMPLETE);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.input.link).toBe(SECURITY_LINK);
    }
  });
});

describe("旧地址那一条：emailTo", () => {
  it("只有 email_changed_old 带 emailTo，其余十三条连这个键都没有", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      const outcome = securityNotice(code, COMPLETE);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect("emailTo" in outcome.input).toBe(
        code === "account.email_changed_old",
      );
    }
  });

  it("旧地址原样进 emailTo（只去前后空白）", () => {
    const outcome = securityNotice("account.email_changed_old", {
      ...BASE,
      emailTo: `  ${OLD_EMAIL}  `,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.emailTo).toBe(OLD_EMAIL);
  });

  it("没有旧地址 / 空白 ⇒ 整条不发，不退成发给当前（＝新）地址", () => {
    for (const emailTo of [undefined, null, "", "   "]) {
      expect(
        securityNotice("account.email_changed_old", { ...BASE, emailTo }),
      ).toEqual({ ok: false, gap: "no_old_address" });
    }
  });

  it("emailTo 是投递地址不是文案：既不进 params，也不进去重锚", () => {
    const outcome = securityNotice("account.email_changed_old", {
      ...BASE,
      emailTo: OLD_EMAIL,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(JSON.stringify(outcome.input.params)).not.toContain(OLD_EMAIL);
    expect(outcome.input.reference.id).not.toContain(OLD_EMAIL);
  });

  it("站内那一半不变：收件人仍然只有本人，仍落在个人租户名下", () => {
    const outcome = securityNotice("account.email_changed_old", {
      ...BASE,
      emailTo: OLD_EMAIL,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.exactRecipients).toEqual([BASE.accountId]);
    expect(outcome.input.tenantId).toBe(BASE.personalTenantId);
  });
});

describe("设备指纹", () => {
  it("按族取，Chrome 自升一个大版本指纹不变", () => {
    expect(deviceFingerprint(CHROME_WIN)).toBe("Chrome/Windows");
    expect(deviceFingerprint(CHROME_WIN_NEXT)).toBe(
      deviceFingerprint(CHROME_WIN),
    );
  });

  it("iPhone 上的 Safari 与 Windows 上的 Chrome 不是同一台", () => {
    expect(deviceFingerprint(SAFARI_IOS)).toBe("Safari/iOS");
    expect(deviceFingerprint(SAFARI_IOS)).not.toBe(
      deviceFingerprint(CHROME_WIN),
    );
  });

  it("认不出来回 null（空串、null、一串不像 UA 的东西）", () => {
    for (const ua of ["", null, "curl/8.7.1"]) {
      expect(deviceFingerprint(ua)).toBeNull();
    }
  });
});

describe("未见过的设备：什么时候不发", () => {
  it("第一次登录不发（priorSuccesses = 0）", () => {
    expect(
      isUnseenDevice("Chrome/Windows", {
        priorSuccesses: 0,
        fingerprints: [],
      }),
    ).toBe(false);
  });

  it("认不出设备不发（指纹为 null）", () => {
    expect(
      isUnseenDevice(null, { priorSuccesses: 9, fingerprints: ["Safari/iOS"] }),
    ).toBe(false);
  });

  it("见过的设备不发", () => {
    expect(
      isUnseenDevice("Chrome/Windows", {
        priorSuccesses: 4,
        fingerprints: ["Chrome/Windows", "Safari/iOS"],
      }),
    ).toBe(false);
  });

  it("登录过、而这台没见过 ⇒ 发", () => {
    expect(
      isUnseenDevice("Chrome/Windows", {
        priorSuccesses: 4,
        fingerprints: ["Safari/iOS"],
      }),
    ).toBe(true);
  });

  it("回看窗口是一个常量、一处定义（改它只改一处）", () => {
    expect(UNSEEN_DEVICE_LOOKBACK_DAYS).toBe(180);
  });
});
