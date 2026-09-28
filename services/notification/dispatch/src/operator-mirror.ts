/**
 * operator-mirror.ts — 客户消息的运营镜像（owner 2026-09-28）。
 * @package @vxture/service-notification
 *
 * owner：「根治是做一个服务端「待办」接口，页面和作业读同一份，尤其运营端收到的信息和
 * 客户侧要完整一致。」
 *
 * 生产实测（2026-09-28）：退款单 ¥99 审核 pending 挂了一上午无人知；三条退订只改了订阅
 * 状态；`admin.operator_notices` 系统来源 0 行——那条写路从建表起就没人走过。缺的不是
 * 某一条通知，是「客户那边发生了什么，运营这边同步知道」这条通路本身。
 *
 * ── 一处定义，全部覆盖 ──
 * `OPERATOR_MIRROR` 对每个客户模板给一条运营侧的标题与严重度，类型是
 * `Record<NotificationTemplateCode, …>`：新加客户模板没配镜像**编译不过**，不会静默漏掉
 * （与 templates.ts 的 TOPIC_OF 同一手法）。
 *
 * ── 一事一条 ──
 * 去重锚 = reference_type `customer_event` + reference_id `{模板}:{引用类型}:{引用 id}`
 * ——与客户收件箱唯一键同一粒度，所以一个客户事件不管有几个收件人只镜像一次；调用方
 * 重放、作业重扫都落成 `inserted: false`。落库走 @vxture/service-notice 的
 * `createSystemNotice`，冲突目标照抄部分唯一索引 `uq_operator_notices_system`。
 *
 * ── 严重度与保留 ──
 * warning = 在等运营动手（退款申请、退订退款、申报待确认、退款执行失败），不过期、直到
 * 处理；info = 周知，30 天后退出列表（不删行）。planes 只给 admin——这些都是客户经营
 * 事实，不是运维（opera）或治理（arche）的事。
 *
 * ── 正文 ──
 * 租户名 · 产品 套餐 · 金额 · 客户收到的那条原文（标题 + 正文）。最后一段保证「完整
 * 一致」：运营看到的就是客户看到的，不另编一套说法。金额参数由调用方用
 * formatNotifyMoney 格式化过（已带币符），这里不再加。
 *
 * ── 失败 ──
 * 镜像只记日志，绝不影响客户消息（客户那条已经落库）。运营这边没镜像成功是运营侧的
 * 缺口，待办接口（@vxture/service-ops-todos）直接算库里的状态兜底。
 */
import type { Pool } from "pg";
import type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
  NoticePlane,
} from "@vxture/service-notice";
import type {
  NotificationReferenceType,
  NotificationTemplateCode,
  TemplateParams,
} from "./templates";

export type OperatorMirrorSeverity = "info" | "warning";

export interface OperatorMirrorEntry {
  readonly severity: OperatorMirrorSeverity;
  /** 运营标题。参数 = 客户模板参数 ∪ 从引用解析出的可视码（orderNo / refundNo）。 */
  readonly title: (params: TemplateParams) => string;
  /** 公告类：一条覆盖多个租户，正文不带租户名、不查租户。 */
  readonly broadcast?: true;
}

/** 缺参留空串——镜像不因一个参数缺失而丢（与 interpolate 同一纪律）。 */
function pick(params: TemplateParams, key: string): string {
  const v = params[key];
  return v === undefined || v === null ? "" : String(v);
}

function plan(params: TemplateParams): string {
  return `${pick(params, "productName")} ${pick(params, "planName")}`.trim();
}

function order(params: TemplateParams): string {
  return pick(params, "orderNo");
}

/**
 * 加油包段：包名 · 加油包单号。缺哪个就不出现那一段，不留空的分隔符。
 *
 * 单号参数与订单共用 `orderNo`（全仓一套词汇）。它住 `metering.addon_purchases`
 * 而不是 `billing.orders`，这件事由**引用类型**承担，不由参数名承担：见 `mirrorLink`。
 */
function addon(params: TemplateParams): string {
  return [pick(params, "packName"), order(params)]
    .filter((v) => v !== "")
    .join(" · ");
}

/**
 * 客户模板 → 运营镜像。标题写运营视角，事实与客户模板同一条。
 * 严重度只在 warning / info 两档里选：critical 留给运维事故，客户事件不用。
 */
export const OPERATOR_MIRROR: Readonly<
  Record<NotificationTemplateCode, OperatorMirrorEntry>
> = {
  "subscription.expiring_soon": {
    severity: "info",
    title: (p) => `客户订阅即将到期 ${plan(p)}（${pick(p, "endAt")}）`,
  },
  "subscription.expired": {
    severity: "info",
    title: (p) => `客户订阅已到期 ${plan(p)}`,
  },
  "subscription.renewed": {
    severity: "info",
    title: (p) => `客户已续费 ${plan(p)} · ${order(p)}`,
  },
  "order.fulfilled": {
    severity: "info",
    title: (p) => `订阅已开通 ${plan(p)} · ${order(p)}`,
  },
  "order.renewal_created": {
    severity: "info",
    title: (p) => `已生成续费订单待付款 ${plan(p)} · ${order(p)}`,
  },
  /* 在等运营审核：直到处理不过期。 */
  "refund.requested": {
    severity: "warning",
    title: (p) => `客户申请退款 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.approved": {
    severity: "info",
    title: (p) => `退款已审核通过 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.rejected": {
    severity: "info",
    title: (p) => `退款申请已驳回 · ${order(p)}`,
  },
  "refund.completed": {
    severity: "info",
    title: (p) => `退款已完成 ${pick(p, "amount")} · ${order(p)}`,
  },
  /* 公告是运营自己发的，镜像只作「已推送」的回执；一条覆盖全部目标租户。 */
  "announcement.published": {
    severity: "info",
    broadcast: true,
    title: (p) => `公告已推送：${pick(p, "title")}`,
  },
  "tenant.invitation": {
    severity: "info",
    title: (p) =>
      `${pick(p, "tenantName")} 邀请了新成员（${pick(p, "roleName")}）`,
  },
  /* 客户已申报、在等确认收款：拖着就是拖客户的钱。 */
  "order.payment_declared": {
    severity: "warning",
    title: (p) =>
      `客户已申报付款 ${pick(p, "amount")} · ${order(p)}，待确认收款`,
  },
  "order.cancelled": {
    severity: "info",
    title: (p) => `客户取消订单 · ${order(p)}（${pick(p, "productName")}）`,
  },
  "order.expired": {
    severity: "info",
    title: (p) => `订单付款超时关闭 · ${order(p)}（${pick(p, "productName")}）`,
  },
  "tenant.converted": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 已升为组织租户`,
  },
  /* 退订三态按退款结果分：只有「要退钱」那一条在等运营。 */
  "subscription.cancelled_refunded": {
    severity: "warning",
    title: (p) => `客户退订并申请退款 ${plan(p)} · ${order(p)}`,
  },
  "subscription.cancelled_no_charge": {
    severity: "info",
    title: (p) => `客户退订 ${plan(p)} · ${order(p)}（¥0 无收费）`,
  },
  "subscription.cancelled_no_refund": {
    severity: "info",
    title: (p) => `客户退订 ${plan(p)} · ${order(p)}（未退款：已过退款窗口）`,
  },
  "subscription.suspension_ended": {
    severity: "info",
    title: (p) => `暂停超期，订阅已终止 ${plan(p)}`,
  },
  "subscription.overdue": {
    severity: "info",
    title: (p) =>
      `客户订阅进入欠费宽限期 ${plan(p)}（${pick(p, "payBy")} 前付款）`,
  },
  "subscription.suspended": {
    severity: "info",
    title: (p) => `订阅已暂停 ${plan(p)}`,
  },
  "subscription.resumed": {
    severity: "info",
    title: (p) => `订阅已恢复 ${plan(p)}`,
  },
  "order.payment_rejected": {
    severity: "info",
    title: (p) => `付款申报已驳回 · ${order(p)}`,
  },
  "order.restored": {
    severity: "info",
    title: (p) => `订单已恢复付款 ${pick(p, "amount")} · ${order(p)}`,
  },
  /* 钱没打出去：客户模板参数里只有 orderNo，refundNo 由镜像从引用解析（见 resolveCodes）。 */
  "refund.failed": {
    severity: "warning",
    title: (p) => `退款执行失败 · ${pick(p, "refundNo") || order(p)}`,
  },
  /* ── 批 5（2026-09-28）的七条，逐条定过，结论是**七条全 info**。────────────
     本文件的 warning 有一个成文含义：「在等运营动手」，于是**不过期**、留在列表里
     直到有人处理。按这条判据逐条问「哪个运营动作能让这条消失」：
       · 两条认证结果 —— 运营**刚刚**自己审的（写入方就是 admin-bff 的 reviewVerification），
         镜像是回执；驳回之后球在客户那边（改资料重交），运营这边没有下一步。
       · 试用到期未转化 —— 没有任何「处理试用到期」的动作；那是销售跟进，不是待办。
       · 加油包开通 / 即将到期 / 用尽 / 过期 —— 客户自助再买一份即可，运营无动作；而且
         这三条来自**每趟重扫同一批行**的巡检，给成不过期的 warning 会在列表里越堆越多。
     给一条永远没人能「处理完」的 warning，正是 info / warning 这个分档要防的事。
     去重锚（mirrorDedupeKey = 模板:引用类型:引用 id）：
       认证 → `tenant:{租户可视码}:{本次审核时刻}`（发侧锚在**这一次审核**上，不锚租户：
         驳回后重新提交再审是另一件事，客户要再收到一次——所以审核时刻必须在键里。
         **不放认证行的 uuid**：`reference_id` 被客户收件箱的读路径原样投影给浏览器
         （console-bff 的 inbox.router → `InboxMessage.referenceId`），uuid 一进这一列
         就过了客户端那条线。形状照 console-bff 席位通告那条：冒号连接的可视码 + 一个
         会变的键。同形的历史债是 `tenant.converted`——那条今天仍是租户 uuid）；
       加油包 → `addon:{加油包单号}`（一单一池、池不重置，每条各一次）；
       「即将到期」那条再带上到期日（`单号:到期日`）：到期日被改了就该再提醒一次。
     链接：认证走引用类型 tenant → `/tenants/{tenant_no}`；加油包**没有**链接——admin 侧
     只有 `/addon-orders` 列表页，按本文件判据（有详情页才给链接）不给列表页链接，
     `mirrorLink` 为此按引用类型把 addon 排除在 `/orders/…` 之外。 */
  "tenant.verification_approved": {
    severity: "info",
    title: (p) => `企业认证已通过 ${pick(p, "tenantName")}`,
  },
  "tenant.verification_rejected": {
    severity: "info",
    title: (p) => `企业认证已驳回 ${pick(p, "tenantName")}`,
  },
  "subscription.trial_expired": {
    severity: "info",
    title: (p) => `客户试用到期未转化 ${plan(p)}`,
  },
  "addon.activated": {
    severity: "info",
    title: (p) => `加油包已开通 ${addon(p)}（${pick(p, "amount")}）`,
  },
  "addon.expiring_soon": {
    severity: "info",
    title: (p) => `客户加油包即将到期 ${addon(p)}（${pick(p, "endAt")}）`,
  },
  "addon.exhausted": {
    severity: "info",
    title: (p) => `客户加油包额度已用尽 ${addon(p)}`,
  },
  "addon.expired": {
    severity: "info",
    title: (p) => `客户加油包已到期 ${addon(p)}`,
  },
  /* 代客续期（2026-09-28 收尾）。**info**：运营自己刚按下的那个按钮，镜像是回执，
     没有任何「下一步」在等人做——正是本文件 warning（不过期、直到处理）要防的反面。
     标题里带上新的到期日：运营在列表里要能一眼看出续到了哪天。 */
  "subscription.renewed_by_operator": {
    severity: "info",
    title: (p) => `运营代客续期 ${plan(p)}（${pick(p, "endAt")}）`,
  },
  /* 维护暂停（2026-09-28 收尾）。**info，不是 warning**，按本文件对 warning 的成文含义
     （「在等运营动手」⇒ 不过期）逐条问「哪个运营动作能让这条消失」：
       · 暂停这件事是运营自己开维护窗口造成的，镜像是回执；
       · 恢复不需要人动手（窗口结束后作业自己放回来），单条订阅这边没有下一步；
       · 而且窗口一延长，同一条模板会带着新的预计恢复日期再镜像一条——给成不过期的
         warning 只会在列表里越堆越多。
     标题带上预计恢复日期：运营看这条最常被问的就是「什么时候回来」。 */
  "subscription.suspended_maintenance": {
    severity: "info",
    title: (p) =>
      `产品升级维护，客户订阅已暂停 ${plan(p)}（预计 ${pick(p, "resumeAt")} 恢复）`,
  },
};

/** 去重锚的 reference_type。与 opera 人工发布（reference 两列为空）天然分开。 */
export const OPERATOR_MIRROR_REFERENCE_TYPE = "customer_event";
/** 只投 admin 平面。 */
export const OPERATOR_MIRROR_PLANES: readonly NoticePlane[] = ["admin"];
/** info 类保留 30 天；warning 类不过期（expires_at = null）。 */
export const OPERATOR_MIRROR_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MirrorReference {
  readonly type: NotificationReferenceType;
  readonly id: string;
}

/** 与客户收件箱唯一键同一粒度：模板 × 引用。 */
export function mirrorDedupeKey(
  code: NotificationTemplateCode,
  reference: MirrorReference,
): string {
  return `${code}:${reference.type}:${reference.id}`;
}

/**
 * 链接：能落到 admin 路由就给。
 *   · 参数里有 orderNo（订单 / 退款 / 退订类都带）→ /orders/{order_no}
 *   · 引用是租户 → /tenants/{tenant_no}
 *   · 其余 null（订阅到期 / 暂停 / 邀请 / 公告没有对应的详情页）
 * 只给可视码，绝不把 uuid 放进地址栏。
 *
 * **加油包（引用类型 addon）故意落在 null 这一档**：admin 只有 `/addon-orders` 列表页，
 * 没有按加油包单号的详情页，判据是「有详情页才给链接」。
 *
 * 它的单号参数与订单一样叫 `orderNo`（全仓一套词汇，调用方按直觉就是这么传的），所以
 * 第一条必须**按引用类型**把 addon 排除掉：`metering.addon_purchases.order_no` 在
 * `billing.orders` 里查不到，`/orders/{加油包单号}` 是一条点开 404 的死链。把这道防线
 * 放在参数名上是只长在一条分支的守卫——下一个人照直觉传 `orderNo` 就又开了门。
 */
export function mirrorLink(
  referenceType: NotificationReferenceType,
  params: TemplateParams,
  tenantNo: string | null,
): string | null {
  const orderNo = order(params);
  if (orderNo && referenceType !== "addon") {
    return `/orders/${encodeURIComponent(orderNo)}`;
  }
  if (referenceType === "tenant" && tenantNo) {
    return `/tenants/${encodeURIComponent(tenantNo)}`;
  }
  return null;
}

export interface OperatorMirrorFacts {
  readonly code: NotificationTemplateCode;
  readonly reference: MirrorReference;
  readonly params: TemplateParams;
  /** 客户实际收到的那条（第一个落库收件人的渲染结果）。 */
  readonly customer: { readonly title: string; readonly body: string };
  readonly tenant: { readonly name: string | null; readonly no: string | null };
  /** 从引用解析出的可视码；参数里已有的优先。 */
  readonly resolved: {
    readonly orderNo: string | null;
    readonly refundNo: string | null;
  };
  readonly now?: Date | undefined;
}

/** 纯函数：事实 → 一条待写的系统通告。单测逐模板断言的就是它。 */
export function composeOperatorNotice(
  facts: OperatorMirrorFacts,
): CreateSystemNoticeInput {
  const entry = OPERATOR_MIRROR[facts.code];
  const params: TemplateParams = { ...facts.params };
  if (!order(params) && facts.resolved.orderNo) {
    params.orderNo = facts.resolved.orderNo;
  }
  if (!pick(params, "refundNo") && facts.resolved.refundNo) {
    params.refundNo = facts.resolved.refundNo;
  }
  const now = facts.now ?? new Date();
  return {
    targetPlanes: OPERATOR_MIRROR_PLANES,
    severity: entry.severity,
    // 列宽 varchar(256)；参数来自库里的产品名 / 单号，正常远不到，截断只是兜底。
    title: entry.title(params).slice(0, 256),
    body: mirrorBody(entry, params, facts.tenant.name, facts.customer),
    link: mirrorLink(facts.reference.type, params, facts.tenant.no),
    referenceType: OPERATOR_MIRROR_REFERENCE_TYPE,
    referenceId: mirrorDedupeKey(facts.code, facts.reference),
    expiresAt:
      entry.severity === "warning"
        ? null
        : new Date(now.getTime() + OPERATOR_MIRROR_INFO_TTL_MS),
  };
}

function mirrorBody(
  entry: OperatorMirrorEntry,
  params: TemplateParams,
  tenantName: string | null,
  customer: { title: string; body: string },
): string {
  const parts: string[] = [];
  if (!entry.broadcast && tenantName) parts.push(`租户 ${tenantName}`);
  const planText = plan(params);
  if (planText) parts.push(planText);
  const amount = pick(params, "amount");
  if (amount) parts.push(amount);
  parts.push(`客户收到：「${customer.title}」${customer.body}`);
  return parts.join(" · ");
}

/** 写侧端口：@vxture/service-notice 的 PgNoticeRepository / NoticeService 都满足。 */
export interface SystemNoticeWriter {
  createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult>;
}

export interface MirrorLogger {
  warn(message: string): void;
}

export interface OperatorMirrorInput {
  readonly tenantId: string;
  readonly templateCode: NotificationTemplateCode;
  readonly reference: MirrorReference;
  readonly params: TemplateParams;
}

/** 分发器看到的镜像面。测试用它注入一个会抛的实现，证明客户消息不受影响。 */
export interface OperatorMirrorPort {
  mirror(
    input: OperatorMirrorInput,
    customer: { readonly title: string; readonly body: string },
  ): Promise<void>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 三条查询导出**只为让 spec 能对谓词下断言**——假 pool 不解析 SQL。
 * 租户名取 display_name（日常展示名），空则回落认证名 name；tenant_no 是 bigint，
 * 转 text 免得 pg 交回 string 还是 number 要猜。
 */
export const MIRROR_TENANT_SQL = `select tenant_no::text as tenant_no,
              coalesce(nullif(display_name, ''), name) as tenant_name
         from tenancy.tenants
        where id = $1`;
export const MIRROR_ORDER_SQL = `select order_no from billing.orders where id = $1`;
export const MIRROR_REFUND_SQL = `select r.refund_no, o.order_no
         from billing.refunds r
         left join billing.orders o on o.id = r.order_id
        where r.id = $1`;

export class OperatorMirror implements OperatorMirrorPort {
  constructor(
    private readonly pool: Pool,
    private readonly notices: SystemNoticeWriter,
    private readonly logger: MirrorLogger,
  ) {}

  /**
   * 永不抛。三步各自降级：租户查不到就不带租户名，可视码解析不到就不带链接，
   * 写库失败只记日志——客户那条消息已经落库，这里的任何失败都不该反过来影响它。
   */
  async mirror(
    input: OperatorMirrorInput,
    customer: { readonly title: string; readonly body: string },
  ): Promise<void> {
    const key = mirrorDedupeKey(input.templateCode, input.reference);
    try {
      const entry = OPERATOR_MIRROR[input.templateCode];
      const [tenant, resolved] = await Promise.all([
        entry.broadcast
          ? Promise.resolve({ name: null, no: null })
          : this.safe(
              () => this.lookupTenant(input.tenantId),
              { name: null, no: null },
              `${key}: tenant lookup failed`,
            ),
        this.safe(
          () => this.resolveCodes(input.reference, input.params),
          { orderNo: null, refundNo: null },
          `${key}: reference lookup failed`,
        ),
      ]);
      await this.notices.createSystemNotice(
        composeOperatorNotice({
          code: input.templateCode,
          reference: input.reference,
          params: input.params,
          customer,
          tenant,
          resolved,
        }),
      );
    } catch (err) {
      this.logger.warn(`operator mirror skipped for ${key} — ${String(err)}`);
    }
  }

  private async safe<T>(
    fn: () => Promise<T>,
    fallback: T,
    label: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`${label} — ${String(err)}`);
      return fallback;
    }
  }

  private async lookupTenant(
    tenantId: string,
  ): Promise<{ name: string | null; no: string | null }> {
    const res = await this.pool.query<{
      tenant_no: string | null;
      tenant_name: string | null;
    }>(MIRROR_TENANT_SQL, [tenantId]);
    const row = res.rows[0];
    const name = row?.tenant_name?.trim();
    return { name: name ? name : null, no: row?.tenant_no ?? null };
  }

  /**
   * 从引用解析可视码。订单引用 = 订单 uuid；退款引用 = `{退款 uuid}:{阶段}`。
   * 参数里已带 orderNo 的订单引用不查；退款引用总要查一次——refund_no 只有库里有，
   * 而「退款执行失败」的标题要它。形状不像 uuid 的引用（复合键等）不查，免得 22P02。
   */
  private async resolveCodes(
    reference: MirrorReference,
    params: TemplateParams,
  ): Promise<{ orderNo: string | null; refundNo: string | null }> {
    const none = { orderNo: null, refundNo: null };
    if (reference.type === "refund") {
      const refundId = reference.id.split(":")[0] ?? "";
      if (!UUID_RE.test(refundId)) return none;
      const res = await this.pool.query<{
        refund_no: string | null;
        order_no: string | null;
      }>(MIRROR_REFUND_SQL, [refundId]);
      const row = res.rows[0];
      return {
        orderNo: row?.order_no ?? null,
        refundNo: row?.refund_no ?? null,
      };
    }
    if (reference.type === "order" && !order(params)) {
      if (!UUID_RE.test(reference.id)) return none;
      const res = await this.pool.query<{ order_no: string | null }>(
        MIRROR_ORDER_SQL,
        [reference.id],
      );
      return { orderNo: res.rows[0]?.order_no ?? null, refundNo: null };
    }
    return none;
  }
}
