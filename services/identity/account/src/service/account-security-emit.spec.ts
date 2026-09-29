/**
 * account-security-emit.spec.ts —— AccountService 的**发信一侧**（2026-09-29）。
 *
 * 此前这个包里只有两种测试：`securityNotice` 的纯组装，以及跨包契约。两种都真，两种都
 * 测不到服务本身——也就是**十四个发信点一个都没被跑过**。症状是这三类，都不报错：
 *
 *   ① 某个发信点根本没接上。`account.email_changed_old` 就是这样：码表、两种语言的正文、
 *      运营镜像、模板测试全都在，唯独没有任何地方发它。所以这里不逐条点名要哪几条，
 *      而是**把跑下来见到的码集合与权威码表比全等**——少接一条当场红。
 *   ② 「没改也发」。手机号 / 邮箱 / 密码登录开关三处的「没变就不发」是三句 if，写反了
 *      只会让客户每次点保存都收一条安全警报，而没有任何断言在看它们。
 *   ③ 一条通知的失败把它观察的那件安全操作判成失败。取事实的两次读一旦被提到
 *      `emit` 的闭包外面，一次库抖动就会让「改密码」这个业务调用抛出去——客户的密码
 *      明明已经改了，页面上说失败。所以这里让每一次读各自抛一遍。
 *
 * 另外钉住那条验收条件：**未注入 notifier ⇒ 为了凑参数而多做的读一次都不发生**。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountService } from "./account.service";
import {
  SECURITY_ACTORS,
  SECURITY_NOTIFICATION_TEMPLATES,
  type AccountNotificationTemplate,
  type CustomerNotifyInput,
} from "./customer-notifier";
import { SECURITY_LINK } from "./security-notifications";
import { MockUserRepository } from "../repository/mock-user.repository";
import type { SignInDeviceHistory, UserView } from "../types/account.types";

const USER_NO = "1234567890";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FIRST_EMAIL = "first@example.com";
const SECOND_EMAIL = "second@example.com";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** 只有通知这条路才会走的那些读。断言「没注入就不多读」时点的就是这几个名字。 */
type NotifyRead =
  | "getUserById"
  | "findUserForAdmin"
  | "findPersonalTenantId"
  | "listRecentSignInDevices";

/**
 * 在 MockUserRepository 上加三样东西：记下每次调用、按名字让某次读抛、以及补上离线
 * mock 刻意留空的那几项（个人租户、登录流水、会话吊销）——不补的话每一条通知都会落在
 * `no_personal_tenant` 上，于是「发信点接没接上」这件事永远测不到。
 */
class SpyRepo extends MockUserRepository {
  readonly calls: string[] = [];
  readonly failing = new Set<NotifyRead>();
  personalTenantId: string | null = TENANT;
  history: SignInDeviceHistory = { priorSuccesses: 0, userAgents: [] };
  revokableSid: string | null = null;
  activeSessions = 0;

  private track(name: NotifyRead | string): void {
    this.calls.push(name);
    if (this.failing.has(name as NotifyRead)) {
      throw new Error(`pg: ${name} — connection terminated unexpectedly`);
    }
  }

  countOf(name: string): number {
    return this.calls.filter((c) => c === name).length;
  }

  override async getUserById(userId: string): Promise<UserView | null> {
    this.track("getUserById");
    return super.getUserById(userId);
  }

  /** 可视码只从这一条读出来，所以锚里出现 user_no 就证明它是在闭包里被调到的。 */
  override async findUserForAdmin(userId: string): Promise<UserView | null> {
    this.track("findUserForAdmin");
    const view = await super.findUserForAdmin(userId);
    return view ? { ...view, userNo: USER_NO } : null;
  }

  override async findPersonalTenantId(_userId: string): Promise<string | null> {
    this.track("findPersonalTenantId");
    return this.personalTenantId;
  }

  override async listRecentSignInDevices(
    _userId: string,
    _withinDays: number,
  ): Promise<SignInDeviceHistory> {
    this.track("listRecentSignInDevices");
    return this.history;
  }

  override async revokeSession(_userId: string, sid: string): Promise<boolean> {
    this.calls.push("revokeSession");
    return sid === this.revokableSid;
  }

  override async revokeAllSessions(_userId: string): Promise<number> {
    this.calls.push("revokeAllSessions");
    return this.activeSessions;
  }
}

/** 口令哈希在这一批里无关：真跑 Argon2id（64 MiB × 十几次）只会把测试拖慢。 */
const hasher = {
  hash: async (plain: string) => `hashed:${plain}`,
  verify: async (plain: string, hash: string) => hash === `hashed:${plain}`,
};

interface Harness {
  repo: SpyRepo;
  service: AccountService;
  sent: CustomerNotifyInput[];
  userId: string;
  /** 这一趟见到的模板码，按发出顺序。 */
  codes: () => AccountNotificationTemplate[];
}

async function harness(opts: { notifier?: boolean } = {}): Promise<Harness> {
  const repo = new SpyRepo();
  const service = new AccountService(repo as never, hasher as never);
  const sent: CustomerNotifyInput[] = [];
  if (opts.notifier !== false) {
    service.setCustomerNotifier({
      notify: async (input) => {
        sent.push(input);
      },
    });
  }
  const user = await repo.createUser({
    account: "takeover",
    email: FIRST_EMAIL,
    phone: "+8613800000001",
    name: "Tester",
    passwordHash: null,
  } as never);
  /* createUser 不经通知路径，但它走 getUserById 之外的路；把计数清干净再开始。 */
  repo.calls.length = 0;
  return {
    repo,
    service,
    sent,
    userId: user.id,
    codes: () => sent.map((s) => s.templateCode),
  };
}

describe("发信点：每一次真的改动恰好一条", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("改密码三种来由 → 两个模板码 + 各自的操作者码", async () => {
    await h.service.setPassword(h.userId, "A1!aaaaa", {
      cause: "self_change",
    });
    await h.service.setPassword(h.userId, "A1!bbbbb", {
      cause: "reset_by_admin",
    });
    await h.service.setPassword(h.userId, "A1!ccccc", {
      cause: "reset_by_email",
    });
    expect(h.codes()).toEqual([
      "account.password_changed",
      "account.password_changed",
      "account.password_reset",
    ]);
    expect(h.sent.map((s) => s.params.actorLabel)).toEqual([
      SECURITY_ACTORS.self,
      SECURITY_ACTORS.tenantAdmin,
      SECURITY_ACTORS.self,
    ]);
  });

  it("自助改密走的是同一条写路径（不是绕过去直连仓储）", async () => {
    await h.service.setPassword(h.userId, "A1!aaaaa", { cause: "initial_set" });
    h.sent.length = 0;
    expect(
      await h.service.changePassword(h.userId, "A1!aaaaa", "A1!ddddd"),
    ).toBe(true);
    expect(h.codes()).toEqual(["account.password_changed"]);
  });

  it("改手机号：换号发一条，**再提交同一个号一条都不发**", async () => {
    await h.service.changePhone(h.userId, "+8613800000002");
    expect(h.codes()).toEqual(["account.phone_changed"]);
    await h.service.changePhone(h.userId, "+8613800000002");
    expect(h.codes()).toEqual(["account.phone_changed"]);
  });

  it("改邮箱：两个地址各一条，旧地址那条带 emailTo", async () => {
    await h.service.changeEmail(h.userId, SECOND_EMAIL);
    expect(h.codes()).toEqual([
      "account.email_changed_new",
      "account.email_changed_old",
    ]);
    const [fresh, old] = h.sent;
    /* 新地址那条不带 emailTo：分发器按 account_id 回查到的就是它。 */
    expect(fresh?.emailTo).toBeUndefined();
    /* 旧地址那条必须是**写之前**那个值，不是刚写进去的这个。 */
    expect(old?.emailTo).toBe(FIRST_EMAIL);
    expect(old?.emailTo).not.toBe(SECOND_EMAIL);
  });

  it("改邮箱：**再提交同一个地址一条都不发**（两条都不发）", async () => {
    await h.service.changeEmail(h.userId, SECOND_EMAIL);
    h.sent.length = 0;
    await h.service.changeEmail(h.userId, SECOND_EMAIL);
    expect(h.sent).toEqual([]);
  });

  it("此前没有邮箱 ⇒ 只发新地址那条，绝不往空地址发", async () => {
    const fresh = await harness();
    await fresh.repo.updateProfile(fresh.userId, { email: null });
    fresh.repo.calls.length = 0;
    await fresh.service.changeEmail(fresh.userId, SECOND_EMAIL);
    expect(fresh.codes()).toEqual(["account.email_changed_new"]);
    expect(fresh.sent.some((s) => s.emailTo !== undefined)).toBe(false);
  });

  it("密码登录开关：翻一次一条，**重复设成同一档一条都不发**", async () => {
    await h.service.setAccountLoginEnabled(h.userId, false);
    expect(h.codes()).toEqual(["account.password_login_disabled"]);
    await h.service.setAccountLoginEnabled(h.userId, false);
    expect(h.codes()).toEqual(["account.password_login_disabled"]);
    await h.service.setAccountLoginEnabled(h.userId, true);
    expect(h.codes()).toEqual([
      "account.password_login_disabled",
      "account.password_login_enabled",
    ]);
    await h.service.setAccountLoginEnabled(h.userId, true);
    expect(h.codes()).toHaveLength(2);
  });

  it("三方绑定 / 解绑：真插了、真删了才发，重放不发", async () => {
    const input = {
      userId: h.userId,
      provider: "feishu",
      providerSubject: "ou_1",
    };
    expect(await h.service.bindIdentity(input as never)).toBe(true);
    /* 社交登录每次都会走到这里，SQL 是 on conflict do nothing——重绑不是一次改动。 */
    expect(await h.service.bindIdentity(input as never)).toBe(false);
    expect(await h.service.removeIdentity(h.userId, "feishu")).toBe(true);
    expect(await h.service.removeIdentity(h.userId, "feishu")).toBe(false);
    expect(h.codes()).toEqual([
      "account.identity_linked",
      "account.identity_unlinked",
    ]);
    expect(h.sent.map((s) => s.params.providerName)).toEqual([
      "feishu",
      "feishu",
    ]);
  });

  it("客户自己下线一台设备：吊掉了才发", async () => {
    h.repo.revokableSid = "sid-active";
    expect(await h.service.revokeSession(h.userId, "sid-gone")).toBe(false);
    expect(h.sent).toEqual([]);
    expect(await h.service.revokeSession(h.userId, "sid-active")).toBe(true);
    expect(h.codes()).toEqual(["account.session_ended_by_self"]);
  });

  it("运营锁定 / 解锁：状态真的翻了才发，原因原样带上", async () => {
    await h.service.adminDisableAccount(h.userId, "风控命中");
    await h.service.adminDisableAccount(h.userId, "风控命中");
    await h.service.adminEnableAccount(h.userId, "已核实本人");
    await h.service.adminEnableAccount(h.userId, "已核实本人");
    expect(h.codes()).toEqual(["account.locked", "account.unlocked"]);
    expect(h.sent.map((s) => s.params.reason)).toEqual([
      "风控命中",
      "已核实本人",
    ]);
  });

  it("运营强制下线：一条会话都没吊掉就不发", async () => {
    await h.service.adminForceLogout(h.userId, "客户报被盗");
    expect(h.sent).toEqual([]);
    h.repo.activeSessions = 2;
    await h.service.adminForceLogout(h.userId, "客户报被盗");
    expect(h.codes()).toEqual(["account.sessions_ended_by_operator"]);
  });

  it("未见过的设备：判据在写流水之前取，通知在之后发", async () => {
    h.repo.history = { priorSuccesses: 3, userAgents: [SAFARI_IOS] };
    const pending = await h.service.detectUnseenDevice(h.userId, CHROME_WIN);
    expect(pending).not.toBeNull();
    /* 取判据的那一步本身不发信——中间是调用方写 login_attempts 的位置。 */
    expect(h.sent).toEqual([]);
    await h.service.notifyUnseenDevice(pending);
    expect(h.codes()).toEqual(["account.new_device_signin"]);
  });

  it("见过的设备 / 第一次登录：pending 为 null，投递那一步直接过", async () => {
    h.repo.history = { priorSuccesses: 3, userAgents: [CHROME_WIN] };
    expect(await h.service.detectUnseenDevice(h.userId, CHROME_WIN)).toBeNull();
    h.repo.history = { priorSuccesses: 0, userAgents: [] };
    expect(await h.service.detectUnseenDevice(h.userId, CHROME_WIN)).toBeNull();
    await h.service.notifyUnseenDevice(null);
    expect(h.sent).toEqual([]);
  });
});

describe("十四条码一条都不许漏接", () => {
  /**
   * 把服务能发的码**集合**与权威码表比全等。这是唯一一条会在「码表里有、却没有任何
   * 地方发它」时变红的断言——`account.email_changed_old` 整个走完设计、文案、镜像、
   * 单测之后仍然零发信方，就是因为没有这条。
   */
  it("跑一遍全部动作，见到的码集合 == SECURITY_NOTIFICATION_TEMPLATES", async () => {
    const h = await harness();
    const { service, userId, repo } = h;

    repo.history = { priorSuccesses: 3, userAgents: [SAFARI_IOS] };
    await service.notifyUnseenDevice(
      await service.detectUnseenDevice(userId, CHROME_WIN),
    );
    await service.setPassword(userId, "A1!aaaaa", { cause: "self_change" });
    await service.setPassword(userId, "A1!bbbbb", { cause: "reset_by_email" });
    await service.changePhone(userId, "+8613800000002");
    await service.changeEmail(userId, SECOND_EMAIL);
    await service.bindIdentity({
      userId,
      provider: "google",
      providerSubject: "sub_1",
    } as never);
    await service.removeIdentity(userId, "google");
    await service.setAccountLoginEnabled(userId, false);
    await service.setAccountLoginEnabled(userId, true);
    repo.revokableSid = "sid-active";
    await service.revokeSession(userId, "sid-active");
    repo.activeSessions = 2;
    await service.adminForceLogout(userId, "客户报被盗");
    await service.adminDisableAccount(userId, "风控命中");
    await service.adminEnableAccount(userId, "已核实本人");

    expect([...new Set(h.codes())].sort()).toEqual(
      [...SECURITY_NOTIFICATION_TEMPLATES].sort(),
    );
  });

  it("每一条都带着落点与「只发本人」，可视码进了去重锚", async () => {
    const h = await harness();
    await h.service.changePhone(h.userId, "+8613800000002");
    const sent = h.sent[0];
    expect(sent?.link).toBe(SECURITY_LINK);
    expect(sent?.exactRecipients).toEqual([h.userId]);
    /* 锚里有 user_no ⇒ findUserForAdmin 确实在闭包里被调到了。 */
    expect(sent?.reference.id).toContain(USER_NO);
    expect(sent?.reference.id).not.toContain(h.userId);
  });
});

describe("通知的失败不许把安全操作判成失败", () => {
  /**
   * 两次取事实各自抛一遍。判据不是「通知发出去了吗」（它当然发不出去），而是**业务调用
   * 本身照旧成功**：改密码的 true、换手机号的那一行、锁定返回的那个壳。
   */
  const reads: NotifyRead[] = ["findUserForAdmin", "findPersonalTenantId"];

  for (const read of reads) {
    it(`${read} 抛了，改密码照旧成功、一条都不发`, async () => {
      const h = await harness();
      await h.service.setPassword(h.userId, "A1!aaaaa", {
        cause: "initial_set",
      });
      h.sent.length = 0;
      h.repo.failing.add(read);
      await expect(
        h.service.changePassword(h.userId, "A1!aaaaa", "A1!bbbbb"),
      ).resolves.toBe(true);
      expect(h.sent).toEqual([]);
      /* 真的抛到了那一次读上——否则这条测试在测一个没发生的事。 */
      expect(h.repo.countOf(read)).toBeGreaterThan(0);
    });

    it(`${read} 抛了，换手机号照旧返回新号`, async () => {
      const h = await harness();
      h.repo.failing.add(read);
      const user = await h.service.changePhone(h.userId, "+8613800000002");
      expect(user?.phone).toBe("+8613800000002");
      expect(h.sent).toEqual([]);
    });

    it(`${read} 抛了，运营锁定照旧回结果`, async () => {
      const h = await harness();
      h.repo.failing.add(read);
      const result = await h.service.adminDisableAccount(h.userId, "风控命中");
      expect(result.user.status).toBe("disabled");
      expect(h.sent).toEqual([]);
    });
  }

  it("notify 自己抛了也一样：业务成功，通知只吞在 emit 里", async () => {
    const repo = new SpyRepo();
    const service = new AccountService(repo as never, hasher as never);
    service.setCustomerNotifier({
      notify: async () => {
        throw new Error("dispatcher: inbox insert failed");
      },
    });
    const user = await repo.createUser({
      account: "throws",
      email: FIRST_EMAIL,
      phone: "+8613800000009",
      name: null,
      passwordHash: null,
    } as never);
    await expect(
      service.changePhone(user.id, "+8613800000010"),
    ).resolves.toMatchObject({ phone: "+8613800000010" });
  });

  it("没有个人租户：不发，但业务照旧成功（社交注册那条尾巴）", async () => {
    const h = await harness();
    h.repo.personalTenantId = null;
    await h.service.changePhone(h.userId, "+8613800000002");
    expect(h.sent).toEqual([]);
  });
});

describe("未注入 notifier：为凑参数多做的读一次都不发生", () => {
  it("换手机号 / 换邮箱 / 开密码登录，三条路都不多读一次", async () => {
    const h = await harness({ notifier: false });
    await h.service.changePhone(h.userId, "+8613800000002");
    await h.service.changeEmail(h.userId, SECOND_EMAIL);
    await h.service.setAccountLoginEnabled(h.userId, true);
    expect(h.sent).toEqual([]);
    /* getUserById 是「开关真的翻了吗」那一读；关的那一档本来就要读（防锁死），所以
       这里只走开的那一档，于是这三条路加起来应当一次都没读。 */
    expect(h.repo.countOf("getUserById")).toBe(0);
  });

  it("findUserForAdmin / findPersonalTenantId 整趟一次都不调", async () => {
    const h = await harness({ notifier: false });
    await h.service.setPassword(h.userId, "A1!aaaaa", { cause: "self_change" });
    h.repo.revokableSid = "sid-active";
    await h.service.revokeSession(h.userId, "sid-active");
    await h.service.adminDisableAccount(h.userId, "风控命中");
    expect(h.repo.countOf("findUserForAdmin")).toBe(0);
    expect(h.repo.countOf("findPersonalTenantId")).toBe(0);
  });

  /**
   * `adminForceLogout` **不在**上面那一趟里，因为它自己就要读一次 `findUserForAdmin`：
   * 那是它的存在性门（读谓词放行已锁定的账号，否则锁定过的人根本强制不了下线），
   * 跟通知无关、在这一批之前就有。所以判据是「有没有多读一次」，不是「读了几次」。
   */
  it("adminForceLogout 那一次读是存在性门：有没有 notifier 都是同一次", async () => {
    const without = await harness({ notifier: false });
    without.repo.activeSessions = 2;
    await without.service.adminForceLogout(without.userId, "客户报被盗");
    expect(without.repo.countOf("findUserForAdmin")).toBe(1);
    expect(without.repo.countOf("findPersonalTenantId")).toBe(0);

    const with_ = await harness();
    with_.repo.activeSessions = 2;
    await with_.service.adminForceLogout(with_.userId, "客户报被盗");
    /* 挂了 notifier 之后多出来的那一次是通知自己的（在 emit 的闭包里）。 */
    expect(with_.repo.countOf("findUserForAdmin")).toBe(2);
    expect(with_.repo.countOf("findPersonalTenantId")).toBe(1);
  });

  it("登录判据那一读也不发生（detectUnseenDevice 直接回 null）", async () => {
    const h = await harness({ notifier: false });
    h.repo.history = { priorSuccesses: 3, userAgents: [SAFARI_IOS] };
    expect(await h.service.detectUnseenDevice(h.userId, CHROME_WIN)).toBeNull();
    expect(h.repo.countOf("listRecentSignInDevices")).toBe(0);
  });

  it("注入回来之后照发（这个开关是可逆的，不是一次性的）", async () => {
    const h = await harness({ notifier: false });
    const sent: CustomerNotifyInput[] = [];
    h.service.setCustomerNotifier({
      notify: async (input) => {
        sent.push(input);
      },
    });
    await h.service.changePhone(h.userId, "+8613800000002");
    expect(sent.map((s) => s.templateCode)).toEqual(["account.phone_changed"]);
  });
});
