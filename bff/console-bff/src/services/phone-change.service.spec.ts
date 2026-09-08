/**
 * phone-change.service.spec.ts — 手机换绑的无状态签名令牌。
 *
 * ── 为什么这块最该测 ──
 * 手机号是账号的**身份锚点**（注册、找回、登录都认它）。这里的每一条拒绝分支
 * 都是一道安全门：验松了别人就能换掉你的手机号，进而接管账号。
 *
 * 而这类缺陷**不报错也不影响任何流程**——签名少验一项，正常用户照样走得通，
 * 只有攻击者会发现。此前这个文件 **0 覆盖**（2026-09-08 清点：console-bff 6.8%，
 * 这 54 行一行没测）。
 *
 * ── 逐条钉住的门 ──
 *  · 签名不对 → 拒（改一个字节就该失效）
 *  · userId 不匹配 → 拒（别人的令牌不能用在我的账号上）
 *  · 过期 → 拒
 *  · purpose 不对 → 拒（换手机的令牌不能拿去干别的）
 *  · 令牌格式坏 / 载荷不是 JSON → 拒，且**不抛**（抛出去会变成 500，
 *    把「无效令牌」暴露成「服务器坏了」）
 *  · 验证码不对 → 拒
 *
 * 另钉一条实现约束：secret 是进程内随机、重启即换，所以**另一个实例签发的令牌
 * 必然失效**。这是有意的（注释写着 "outstanding tokens expire naturally"），
 * 但它意味着多实例部署下换绑会随机失败——用一条断言把这个事实记在明处。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneChangeService } from "./phone-change.service";

/* 给 vi.fn 显式签名:不给的话参数被推断成空元组,`calls.at(-1)?.[0]` 是 never,
   type-check 报 TS2493——而 vitest 不做类型检查,测试照样全绿。
   (2026-09-08 第二次踩:上一次是 ReturnType<typeof vi.fn> 接不上 MailSender。) */
type MailArg = { to: string; subject: string; html: string; text: string };
const mail = { send: vi.fn(async (_m: MailArg) => undefined) };
const make = () => new PhoneChangeService(mail as never);

const USER = "usr-1";
const OTHER = "usr-2";
const PHONE = "+8613800000000";

/** 从发信内容里取出那 6 位验证码——服务不返回它，只发邮件。 */
function codeFromMail(): string {
  const body = String(mail.send.mock.calls.at(-1)?.[0]?.text ?? "");
  const m = body.match(/(\d{6})/);
  if (!m) throw new Error("邮件正文里没有验证码，测试前提不成立");
  return m[1]!;
}

describe("邮箱 OTP", () => {
  let svc: PhoneChangeService;
  beforeEach(() => {
    mail.send.mockClear();
    svc = make();
  });

  it("正确的验证码 + 正确的 userId → 通过", async () => {
    const token = await svc.sendEmailOtp(USER, "a@example.com");
    expect(svc.verifyEmailOtp(token, codeFromMail(), USER)).toBe(true);
  });

  it("验证码错 → 拒", async () => {
    const token = await svc.sendEmailOtp(USER, "a@example.com");
    const wrong = String((Number(codeFromMail()) + 1) % 1000000).padStart(
      6,
      "0",
    );
    expect(svc.verifyEmailOtp(token, wrong, USER)).toBe(false);
  });

  it("换个 userId 用同一个令牌 → 拒（别人的令牌不能用在我账号上）", async () => {
    const token = await svc.sendEmailOtp(USER, "a@example.com");
    expect(svc.verifyEmailOtp(token, codeFromMail(), OTHER)).toBe(false);
  });

  it("令牌被改一个字节 → 拒", async () => {
    const token = await svc.sendEmailOtp(USER, "a@example.com");
    const code = codeFromMail();
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    expect(svc.verifyEmailOtp(tampered, code, USER)).toBe(false);
  });

  it("过期 → 拒（OTP 5 分钟）", async () => {
    vi.useFakeTimers();
    try {
      const token = await svc.sendEmailOtp(USER, "a@example.com");
      const code = codeFromMail();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(svc.verifyEmailOtp(token, code, USER)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("验证码确实发到了那个邮箱（不是发给别人）", async () => {
    await svc.sendEmailOtp(USER, "a@example.com");
    expect(mail.send.mock.calls.at(-1)?.[0]?.to).toBe("a@example.com");
  });
});

describe("身份令牌", () => {
  let svc: PhoneChangeService;
  beforeEach(() => {
    svc = make();
  });

  it("签发后可验，并带回当前手机号", () => {
    const t = svc.issueIdentityToken(USER, PHONE);
    expect(svc.validateIdentityToken(t, USER)).toEqual({ currentPhone: PHONE });
  });

  it("userId 不匹配 → null", () => {
    const t = svc.issueIdentityToken(USER, PHONE);
    expect(svc.validateIdentityToken(t, OTHER)).toBeNull();
  });

  it("签名被改 → null", () => {
    const t = svc.issueIdentityToken(USER, PHONE);
    const [body, sig] = [
      t.slice(0, t.lastIndexOf(".")),
      t.slice(t.lastIndexOf(".") + 1),
    ];
    expect(
      svc.validateIdentityToken(`${body}.${sig.slice(0, -1)}0`, USER),
    ).toBeNull();
  });

  it("载荷被改（换个手机号）→ null，签名保护的正是这个", () => {
    const t = svc.issueIdentityToken(USER, PHONE);
    const sig = t.slice(t.lastIndexOf(".") + 1);
    const evil = Buffer.from(
      JSON.stringify({
        userId: USER,
        currentPhone: "+8613900000000",
        exp: Date.now() + 60000,
        purpose: "phone-change",
      }),
    ).toString("base64url");
    expect(svc.validateIdentityToken(`${evil}.${sig}`, USER)).toBeNull();
  });

  it("过期 → null（身份令牌 10 分钟）", () => {
    vi.useFakeTimers();
    try {
      const t = svc.issueIdentityToken(USER, PHONE);
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      expect(svc.validateIdentityToken(t, USER)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("OTP 令牌不能当身份令牌用（purpose 门）", async () => {
    const otp = await svc.sendEmailOtp(USER, "a@example.com");
    // OTP 令牌的载荷没有 purpose 字段，purpose 那道门必须挡住它。
    expect(svc.validateIdentityToken(otp, USER)).toBeNull();
  });
});

describe("坏输入一律拒且不抛", () => {
  const svc = make();

  // 抛出去会变成 500，把「无效令牌」暴露成「服务器坏了」，也给了探测者信号。
  it.each(["", ".", "abc", "no-dot-here", "!!!.!!!", "e30.badsig"])(
    "令牌 %p → 拒，不抛",
    (bad) => {
      expect(() => svc.validateIdentityToken(bad, USER)).not.toThrow();
      expect(svc.validateIdentityToken(bad, USER)).toBeNull();
      expect(() => svc.verifyEmailOtp(bad, "123456", USER)).not.toThrow();
      expect(svc.verifyEmailOtp(bad, "123456", USER)).toBe(false);
    },
  );

  it("载荷是合法 base64 但不是 JSON → 拒，不抛", () => {
    const junk = Buffer.from("不是 JSON").toString("base64url");
    expect(svc.validateIdentityToken(`${junk}.deadbeef`, USER)).toBeNull();
  });
});

describe("secret 是进程内随机——多实例部署下令牌不通用", () => {
  it("另一个实例签发的令牌验不过", () => {
    // 这是有意的（注释：outstanding tokens expire naturally），但它意味着
    // 多实例部署时换绑会随机失败。把这个事实记在明处，别哪天当成偶发 bug 查。
    const a = make();
    const b = make();
    expect(
      b.validateIdentityToken(a.issueIdentityToken(USER, PHONE), USER),
    ).toBeNull();
  });
});
