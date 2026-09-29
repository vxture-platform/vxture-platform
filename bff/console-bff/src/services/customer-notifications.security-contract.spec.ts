/**
 * customer-notifications.security-contract.spec.ts —— 账号安全线那份**照抄的副本**是否还对得上
 * 权威（2026-09-29）。
 *
 * ── 为什么这条用例必须存在，而且必须住在 console-bff ──
 * 账号安全事件的模板码、`occurredAt` 的格式、去重锚的形状，权威都在
 * `@vxture/service-notification`（dispatch 的 `templates.ts`：`SECURITY_TEMPLATE_CODES` 与
 * `securityEventStamp`）。但写入方在 `@vxture/service-account`，而 identity 层**不许依赖**
 * notification 层（depcruise 的边界规则），所以那边只能照抄一份
 * （`customer-notifier.ts` 的 `securityReferenceId` / `formatOccurredAt`）。
 *
 * 照抄的代价是两份会漂，而漂的症状**不是报错**：
 *   · 锚少了时刻 ⇒ 收件箱的唯一键 `(account_id, template_code, reference_type, reference_id)`
 *     把客户**第二次**改密码静默压掉——正是这一批最怕的那件事（接管者第二次改密时本人无声）。
 *   · 模板码差一个字 ⇒ `topicOf` 那张穷尽映射当场抛，`emit` 捕获后只记一行日志，客户什么也
 *     收不到，而编译器、守卫、boot-smoke 全绿。
 *   · `occurredAt` 的格式差一截 ⇒ 正文里的时刻少了时区或少了秒，没人会因此报错。
 *
 * **console-bff 是唯一同时依赖两个包的地方**（auth-bff 今天还没有 notification 依赖），
 * 所以这条对账只能落在这里。它不是「拿被测的那份证明它自己」：两边的实现各写各的，这里
 * 逐字比结果。
 */
import { describe, expect, it } from "vitest";
import {
  SECURITY_NOTIFICATION_TEMPLATES,
  SECURITY_REFERENCE_TYPE as ACCOUNT_SECURITY_REFERENCE_TYPE,
  securityReferenceId,
  securityNotice,
  type AccountNotificationTemplate,
} from "@vxture/service-account";
import {
  SECURITY_REFERENCE_TYPE,
  SECURITY_TEMPLATE_CODES,
  securityEventStamp,
  topicOf,
  type SecurityTemplateCode,
} from "@vxture/service-notification";

/** 固定时刻：对账要的是「两边逐字相同」，不是「今天是几号」。 */
const AT = new Date("2026-09-29T12:14:32.789Z");
const USER_NO = "1234567890";

describe("账号安全线：service-account 的副本 vs dispatch 的权威", () => {
  it("模板码全集逐条相等（多一条 / 少一条 / 差一个字都红）", () => {
    expect([...SECURITY_NOTIFICATION_TEMPLATES].sort()).toEqual(
      [...SECURITY_TEMPLATE_CODES].sort(),
    );
  });

  it("引用类型是同一个值", () => {
    expect(ACCOUNT_SECURITY_REFERENCE_TYPE).toBe(SECURITY_REFERENCE_TYPE);
  });

  it("每一条的去重锚与 securityEventStamp 逐字相同", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      const authoritative = securityEventStamp(
        code as SecurityTemplateCode,
        USER_NO,
        AT,
      );
      expect(securityReferenceId(USER_NO, code, AT)).toBe(
        authoritative.reference.id,
      );
    }
  });

  it("用户号形状不对时两边同样退成 unknown（绝不让 uuid 过客户端那条线）", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const code: AccountNotificationTemplate = "account.password_reset";
    expect(securityReferenceId(uuid, code, AT)).toBe(
      securityEventStamp(code, uuid, AT).reference.id,
    );
    expect(securityReferenceId(uuid, code, AT)).not.toContain(uuid);
    expect(securityReferenceId(null, code, AT)).toBe(
      securityEventStamp(code, "", AT).reference.id,
    );
  });

  it("occurredAt 的格式与权威逐字相同（带秒、带时区）", () => {
    const outcome = securityNotice("account.password_reset", {
      accountId: "acct",
      userNo: USER_NO,
      personalTenantId: "tenant",
      occurredAt: AT,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.params.occurredAt).toBe(
      securityEventStamp("account.password_reset", USER_NO, AT).occurredAt,
    );
    /* 形状本身也钉一次：两边一起漂的话上面那条比不出来（一致 ≠ 正确）。 */
    expect(outcome.input.params.occurredAt).toBe("2026-09-29 20:14:32 (UTC+8)");
  });

  it("十四条全都落在那两个主题上（写入方发得出、偏好里关得掉）", () => {
    for (const code of SECURITY_NOTIFICATION_TEMPLATES) {
      expect(["security_event", "login_activity"]).toContain(topicOf(code));
    }
    /* 只有「没见过的设备」那一条归 login_activity（owner 裁定 6 的那半：可关）。 */
    expect(topicOf("account.new_device_signin")).toBe("login_activity");
    expect(topicOf("account.locked")).toBe("security_event");
  });

  it("锚的长度留足余量（reference_id 是 varchar(128)，按真实码表重算不手抄）", () => {
    const longest = Math.max(
      ...SECURITY_NOTIFICATION_TEMPLATES.map(
        (code) => securityReferenceId(USER_NO, code, AT).length,
      ),
    );
    expect(longest).toBeLessThanOrEqual(128);
    /* 运营镜像那一层还要再套一层 `{模板}:{引用类型}:{锚}`，也得在 128 之内。 */
    const longestMirrored = Math.max(
      ...SECURITY_NOTIFICATION_TEMPLATES.map(
        (code) =>
          `${code}:${SECURITY_REFERENCE_TYPE}:${securityReferenceId(USER_NO, code, AT)}`
            .length,
      ),
    );
    expect(longestMirrored).toBeLessThanOrEqual(128);
  });
});
