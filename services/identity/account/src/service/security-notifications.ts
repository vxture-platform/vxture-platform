/**
 * security-notifications.ts — 账号安全事件的**纯**组装（2026-09-29）。
 * @package @vxture/service-account
 *
 * 这里没有 IO：事实进、`CustomerNotifyInput` 出，或者「发不出去 + 为什么」出。
 * 单测逐条断言的就是它——去重锚的形状、参数名、以及「什么时候刻意不发」这三件全在这一个
 * 文件里定死，服务那侧只负责取事实与 best-effort 投递。
 */
import {
  ACTOR_PARAM,
  PROVIDER_PARAM,
  SECURITY_REFERENCE_TYPE,
  formatOccurredAt,
  securityReferenceId,
  type AccountNotificationTemplate,
  type CustomerNotifyInput,
} from "./customer-notifier";

/**
 * 「这台设备我见过吗」的回看窗口 = **180 天**。
 *
 * 为什么不是 30：`listLoginHistory` 那个 30 天是**展示**上限（账号页只列近一个月），拿它当
 * 判据会把「每两个月开一次笔记本」的客户变成每次都收警报——而这条通知一旦被学会忽略，就等于
 * 没有（owner 就是按这条理由把「没见过的 IP」整条否掉的）。
 *
 * 为什么不是「全部历史」：`session.login_attempts` 是 append-only、**没有清扫作业**，全表
 * 回看等于让一台四年前用过一次的设备永久算「见过」。180 天是「还算同一批设备」与「久到该
 * 重新确认一次」之间的取舍，而且它是一个常量、一处定义，要改只改这里。
 *
 * 另一半代价说清楚：窗口内没出现过的老设备会被当成新设备发一条。那是**误报方向**的保守，
 * 与漏报相反——这一批宁可多说一句，不可少说一句。
 */
export const UNSEEN_DEVICE_LOOKBACK_DAYS = 180;

/**
 * 设备指纹 = 浏览器族 + 操作系统族，**刻意粗**。
 *
 * 判据是「这条通知值不值得客户看」。裸 user-agent 串里带小版本号，Chrome 每四周自升一次就会
 * 变——按裸串比，等于每个月给每个客户发一条「新设备登录」，两个月后没人再看它。反过来说，
 * 同族同系统的两台机器分不开：这是这条信号的**成文上限**，不是漏洞。真要分到机器，前置是
 * 一个写在登录时的设备 id（今天 `session.login_attempts` 里没有这一列），那是另一件事，不是
 * 把正则写细能换来的。
 *
 * 取不到（UA 为空 / 两项都认不出）→ 返回 null，调用方据此**不发**：分不出新旧的时候发一条，
 * 只会变成一条永久的假警报。
 *
 * 指纹**只用于判断，不进任何文案**：权威模板的十四条正文里没有设备参数（dispatch 的
 * `BODIES_ZH`：「在一台此前没有用过的设备上登录」）。裸 UA 串更不会进——那是一行技术噪音，
 * 客户读不出「这是我吗」，而这条消息存在的全部目的就是让他读出来。
 */
export function deviceFingerprint(userAgent: string | null): string | null {
  const browser = parseBrowser(userAgent);
  const os = parseOS(userAgent);
  if (!browser && !os) return null;
  return `${browser || "?"}/${os || "?"}`;
}

/**
 * 词表与 console 账号页那两个 `parseOS` / `parseBrowser` 同一套（那边是前端展示、这边是
 * 判据，各自在自己那一侧；真要合并，家在 @vxture-platform/shared，不在这里）。
 */
function parseOS(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "";
}

function parseBrowser(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/MicroMessenger/i.test(userAgent)) return "WeChat";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "";
}

/** 一条安全事件发得出去所需要的全部事实。 */
export interface SecurityNotifyFacts {
  /** 收件人 = 事情发生在谁的账号上。 */
  readonly accountId: string;
  /** 可视码；去重锚用它，**不用账号 uuid**。取不到 / 形状不对 → 锚里退成 `unknown`。 */
  readonly userNo: string | null | undefined;
  /** 个人租户 id；`support.inbox_messages.tenant_id` 是 NOT NULL。 */
  readonly personalTenantId: string | null | undefined;
  readonly occurredAt: Date;
  /**
   * 运营处置那三条的原因，**照搬运营填的那一句**（owner 2026-09-29 裁定第 3 条）。
   * 这里不给默认值：没有原因就整条不发（`no_reason`）——自己编一句「因违反平台规则」既是
   * 假话，又会把「运营没填」这个缺陷永久盖住。端点那一侧的 400 见 auth-bff 的内部路由。
   */
  readonly reason?: string | null | undefined;
  /**
   * 操作者**码**（`self` / `tenant_admin` / `operator`，见 SECURITY_ACTORS），只有
   * `account.password_changed` 要。放码不放词：词按收件人语言在模板层成形。
   */
  readonly actor?: string | null | undefined;
  /** 第三方登录的**码**（`google` / `feishu` / `dingtalk` / `wechat`），绑定 / 解绑两条要。 */
  readonly provider?: string | null | undefined;
  /**
   * **换走之前**那个邮箱地址，只有 `account.email_changed_old` 要，且是**硬门**。
   *
   * owner 裁定：换邮箱要通知两个地址——只通知新地址的话，账号被接管之后那句警告正好送到
   * 接管者手上。而旧地址这一半分发器自己取不到：它按 account_id 回查收件人当前的邮箱，
   * 邮箱写完之后那就是新地址了。所以调用方**必须在写之前捕获**它并带进来（服务层那一处
   * 有注释），这里只负责把它放进 `emailTo`，缺了就整条不发（`no_old_address`）。
   */
  readonly emailTo?: string | null | undefined;
}

/**
 * 每条事件各自额外要的那几项。`accountId` / `userNo` / `personalTenantId` / `occurredAt`
 * 四项由服务层统一取，调用点不必（也不该）各取一遍。
 */
export type SecurityNotifyExtras = Omit<
  SecurityNotifyFacts,
  "accountId" | "userNo" | "personalTenantId" | "occurredAt"
>;

/** 发不出去的原因。要**记一行日志**，不许静默返回——否则「没发」和「发了」在日志里一样。 */
export type SecurityNotifyGap =
  | "no_personal_tenant"
  | "no_reason"
  | "no_old_address";

export type SecurityNotifyOutcome =
  | { readonly ok: true; readonly input: CustomerNotifyInput }
  | { readonly ok: false; readonly gap: SecurityNotifyGap };

/**
 * 必须带 `reason` 的那三条：运营处置。**这三条是唯一的硬门。**
 *
 * 为什么 `actor` / `provider` 缺了照发、只有 `reason` 缺了不发：权威模板层对码不认识或没给
 * 一律**回落成一句实话**（「未能确认的操作者」/「未知的第三方登录」，见 dispatch 的
 * `wordOf`），所以那两项缺失的代价是一句略含糊但不假的话，而「安全通知没送到」正是这一批
 * 存在的理由本身——两害相权，照发。`reason` 不同：整条正文的信息量就在那句话里，缺了它客户
 * 读到「平台已锁定你的账号…原因：。」，那不是含糊，是一句坏掉的话。
 */
const NEEDS_REASON: ReadonlySet<string> = new Set([
  "account.locked",
  "account.unlocked",
  "account.sessions_ended_by_operator",
]);

/**
 * 唯一一条把邮件改送到别的地址的模板：写给**旧地址**的那一条。
 * 写成常量而不是字面量，因为服务层那一处与这里要指同一条码；两处各写一遍就会漂。
 */
const OLD_ADDRESS_TEMPLATE: AccountNotificationTemplate =
  "account.email_changed_old";

/**
 * 账号安全事件的点击落点 = console 的**我的账号**页 `/profile`。**一处定义，不许抄第二份。**
 *
 * 值从 console 自己的两份配置对出来：路由表 `portals/console/src/config/routes.ts` 的
 * `routeLabels` 里有 `/profile`，侧栏 `config/navigation.ts` 的 `accountTenantSection` 也指着
 * 它，而 `app/[locale]/(console)/profile/page.tsx` 是真页面——三样齐了才叫「点得进去」。
 * 单测按那几个文件对账，不照抄这个字符串。
 *
 * 此前这里写的是 `/account/profile`。那是 `@/modules/account/profile/ProfilePage` 这个**源码
 * 路径**的形状，不是路由：console 里根本没有 `/account` 这一段，于是十四条安全通知每一条
 * 点开都是 404——而让它上线的正是一个手抄的期望值，它和被测的那个常量一起错，所以永远相等。
 *
 * 为什么不是 `/security`：那条路由从 2026-09-04 起只是一条跳转（安全设置整段并入我的账号，
 * 见 console 那个 page.tsx）。发一个会 302 的地址等于让客户多跳一次，而跳转的目标随时会
 * 再变一次。
 */
export const SECURITY_LINK = "/profile";

function trimmed(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 事实 → 一条待发的通知，或「为什么发不出」。
 *
 * **参数名是跨包钉死的**：时刻一律 `occurredAt`、操作者一律 `actorLabel`（ACTOR_PARAM）、
 * 第三方一律 `providerName`（PROVIDER_PARAM）。写错一个名字不会报错——`interpolate` 把缺的
 * 那个替换成空串，于是客户读到一句带洞的话，而这正是上一轮两个人各写一个参数名换来的代价。
 * 所以这里不写字面量参数名，直接用与权威那侧同名的常量。
 */
export function securityNotice(
  templateCode: AccountNotificationTemplate,
  facts: SecurityNotifyFacts,
): SecurityNotifyOutcome {
  const tenantId = trimmed(facts.personalTenantId);
  if (!tenantId) return { ok: false, gap: "no_personal_tenant" };

  const params: Record<string, string | number> = {
    occurredAt: formatOccurredAt(facts.occurredAt),
  };

  if (NEEDS_REASON.has(templateCode)) {
    const reason = trimmed(facts.reason);
    if (!reason) return { ok: false, gap: "no_reason" };
    params.reason = reason;
  }
  const actor = trimmed(facts.actor);
  if (actor) params[ACTOR_PARAM] = actor;
  const provider = trimmed(facts.provider);
  if (provider) params[PROVIDER_PARAM] = provider;

  /* 旧地址那一条的硬门。缺了它整条不发，**不是**照发：这条正文写的是「这个邮箱不再收到该
     账号的通知」，而没有 `emailTo` 时邮件会走回查出来的当前地址——也就是新地址，于是那句话
     送到了唯一一个它不成立的信箱里，还正好是接管者的那个。空串同理，只是它连地址都没有。 */
  let emailTo: string | undefined;
  if (templateCode === OLD_ADDRESS_TEMPLATE) {
    const address = trimmed(facts.emailTo);
    if (!address) return { ok: false, gap: "no_old_address" };
    emailTo = address;
  }

  return {
    ok: true,
    input: {
      tenantId,
      templateCode,
      reference: {
        type: SECURITY_REFERENCE_TYPE,
        id: securityReferenceId(facts.userNo, templateCode, facts.occurredAt),
      },
      params,
      exactRecipients: [facts.accountId],
      link: SECURITY_LINK,
      /* 不给就整个字段不出现：`emailTo` 缺省的语义是「按今天那样回查当前邮箱」，
         写成 `emailTo: undefined` 会让 JSON 里多出一个键，白让下游多一个要判的形状。 */
      ...(emailTo ? { emailTo } : {}),
    },
  };
}

/**
 * 「这次登录的设备见过吗」。
 *
 * 三种情形**都不发**，各有各的理由：
 *   · 指纹取不到（UA 为空 / 认不出）——分不出新旧就别发，否则是一条永久假警报。
 *   · 一次成功登录都没有过——这是**本人的第一次登录**。给刚注册完的人发一条「在一台此前
 *     没有用过的设备上登录」，第一印象就是一句吓人的话，而它描述的正是他自己此刻做的事。
 *   · 指纹在回看窗口里出现过——见过的设备，不发。
 *
 * 判据只看**成功**的登录：失败尝试里的 UA 是攻击者的，把它算进「见过」等于让一次撞库失败
 * 给后续的成功登录发了通行证。
 */
export function isUnseenDevice(
  fingerprint: string | null,
  history: { priorSuccesses: number; fingerprints: readonly string[] },
): boolean {
  if (!fingerprint) return false;
  if (history.priorSuccesses <= 0) return false;
  return !history.fingerprints.includes(fingerprint);
}
