/**
 * ops-notice.ts — platform-api 这一侧「运营通告」的共同词汇（2026-09-28 第二批）。
 * @package @vxture/bff-platform-api
 *
 * 第二批的热路径信号与两条已有邮件告警都要**顺手写一条运营通告**（admin.operator_notices，
 * 经 @vxture/service-notice 的 createSystemNotice 落库，冲突即 do nothing）。
 *
 * 每条通告的标题与正文长在**事件发生的那个文件**里——配额耗尽在 platform/usage-view，
 * 作业健康与自愈放弃在 notifications/operator-alerts.wiring，自动续费在订阅服务包自己。
 * 理由与 operator-mirror 同一条：文案是那件事的一部分，搬到公共文件里就会和事实脱节。
 * 这里只放**它们都要**的那几样：
 *
 *   · 去重锚的 reference_type 与 reference_id 的长度收口。`reference_id` 是
 *     varchar(128)，而「{事件}:{workspace uuid}:{product}:{metric}:{周期起点}」这类键
 *     在 metric_key 取满 64 字时会越界 —— 越界的后果是 22001，通告静默丢一条（写失败
 *     只记日志，见下）。所以超长时截断并缀一段内容哈希：仍然一事一条，且不会两件事撞成一条。
 *   · 写入口 writeOpsNotice：**失败只记日志**，绝不反过来打断业务路径。运营少一条通告
 *     是运营侧的缺口，把客户的请求或作业的这一轮打断是另一回事，两者不可交换。
 *   · 可视码解析：通告的标题、正文、链接里**一律不出现 UUID**（全站铁律），所以要先把
 *     tenant_id / workspace_id 换成 tenant_no 与显示名。解析失败降级成「（租户未知）」，
 *     不因为查不到名字就不发通告。称呼一律经 @shared 的 formatPrincipalNo 带上 T- 前缀。
 *   · redactUuids：同一条铁律的**另一半**。上面管我们自己写的字，这个管**引进来的字**
 *     ——错误原文里的 uuid（详见该函数）。
 *   · opsNoticeDayKey：按「哪一天」收敛的去重键取 Asia/Shanghai 日历日，不取 UTC 日。
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { formatPrincipalNo } from "@vxture-platform/shared";
import type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
} from "@vxture/service-notice";

/**
 * 本批热路径信号共用的 reference_type。
 *
 * 与批一的 `customer_event`（客户消息的镜像）、巡检的 `business_event` / `audit`
 * 分开：那几类在库里本来就有一行可观测的记录，重扫一遍会落成同一条；这几类**没有行**，
 * 只在事情发生的那一刻存在，去重键是各自算出来的。混进同一个 reference_type 里，
 * 两套键规则就会挤在一个唯一索引上，改任一套都要担心撞另一套。
 */
export const OPS_SIGNAL_REFERENCE_TYPE = "ops_signal";

/**
 * admin.operator_notices.reference_id 的列宽。超了是 22001，不是「截断后照写」。
 *
 * `support.notification_logs.reference_id`（运营告警邮件的 4h 静默窗口键）**也是
 * varchar(128)**，而 OperatorAlertDispatcher 写账本时不截这一列——所以邮件那一侧也用
 * `opsNoticeReferenceId` 收口（见 operator-alerts.wiring 的 maintenance_overdue 一支）。
 * 两张表的列宽将来若分家，这个常量要跟着分成两个，别只改一头。
 */
export const OPS_NOTICE_REFERENCE_ID_MAX = 128;

/**
 * info 档与「一个周期一条」的周期性 warning 保留 30 天后退出列表（不删行）。
 * 与批一 OPERATOR_MIRROR_INFO_TTL_MS 同一个数：两套通告出现在同一张列表里，
 * 保留期不同会让人以为丢了几条。
 */
export const OPS_NOTICE_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 写侧端口：@vxture/service-notice 的 PgNoticeRepository / NoticeService 都满足。 */
export interface SystemNoticeWriter {
  createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult>;
}

/** 只要 warn 一个方法——Nest 的 Logger 与 spec 里的假实现都满足。 */
export interface OpsNoticeLogger {
  warn(message: string): void;
}

/**
 * 去重键 → reference_id。128 以内原样（**绝大多数如此**，读的人能一眼看懂这条通告
 * 是哪件事），超长则留前 119 字 + 冒号 + 全键的 8 位 sha256。
 *
 * 为什么不一律哈希：去重键是排查时唯一能把通告与事件对上的东西，把它变成一串十六进制，
 * 代价落在将来查库的人身上。为什么截断还要缀哈希：两个 metric_key 前缀相同的事件截断
 * 后会变成同一个键，那就成了「一条挡住另一条」——比多发一条坏得多。
 */
export function opsNoticeReferenceId(key: string): string {
  if (key.length <= OPS_NOTICE_REFERENCE_ID_MAX) return key;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `${key.slice(0, OPS_NOTICE_REFERENCE_ID_MAX - 9)}:${digest}`;
}

/**
 * 通告里的租户称呼：显示名（T- 可视码）。两样都没有就说「未知」，不写 UUID。
 *
 * 前缀**不在这里拼**，走 @shared 的 `formatPrincipalNo`——U- / T- / W- 的唯一实现。
 * 此前这里直接插裸号，通告上就是「示例科技（2584353581）」：三种主体码都是 10 位纯
 * 数字、长得一模一样，运营看见它分不出是租户还是工作空间，复制去搜也搜不到（别处显示
 * 的是带前缀的）。同一批的 business-event-signals / audit-event-signals 从第一天起
 * 就走这个函数，只有热路径这三处漏了。
 */
export function opsNoticeTenantLabel(tenant: {
  no: string | null;
  name: string | null;
}): string {
  const name = tenant.name?.trim() ?? "";
  const no = formatPrincipalNo(tenant.no, "tenant");
  if (no && name) return `${name}（${no}）`;
  if (no) return `租户 ${no}`;
  if (name) return name;
  return "（租户未知）";
}

/**
 * Asia/Shanghai 与 UTC 的固定时差。中国自 1991 年起不再实行夏令时，全年恒 +8，
 * 所以这个偏移是精确的、不是近似（同一判断见 add-cycle.spec 里那条注释）。
 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 「一天一条 / 一个周期一条」的日期键：**Asia/Shanghai 日历日**，不是 UTC 日。
 *
 * 为什么必须是本地日：这些键是按「哪一天」收敛的，而看这块板的人在北京。取 UTC 日的
 * 话，每天 08:00 之前写的通告都落进前一天那格——于是同一件事在 00:00–08:00 与
 * 08:00 之后各播一条（跨午夜重复播），而真正该分成两天的 00:00–08:00 反倒和前一天并成
 * 了一格。审计巡检那一侧早就是这个口径（SQL 里 `at time zone 'Asia/Shanghai'`），
 * 热路径这几处当初照抄了 `toISOString()`，与它差 8 小时。
 *
 * 不用 Intl：本文件不做展示格式化，只要一个形状固定的数据键；固定偏移加完取 ISO 前
 * 10 位就是它，也不必再给 check-datetime-discipline 开一条豁免。
 */
export function opsNoticeDayKey(at: Date): string {
  return new Date(at.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** uuid 形状的子串。全局 + 忽略大小写：一段错误文本里可能带好几个，大小写两种都有。 */
const UUID_IN_TEXT_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** 抹掉 uuid 后留下的痕迹：读的人要知道这里原本有个 id，而不是以为句子断了。 */
export const UUID_REDACTED_MARK = "（已隐去内部 id）";

/**
 * 把一段**要嵌进通告 / 告警正文**的文本里的 uuid 抹掉。
 *
 * 为什么非有它不可：通告的标题、正文、链接里一律不出现 UUID（全站铁律），而这几条
 * 通告偏偏要把**错误原文**放进正文——错误原文是最常带 uuid 的东西（`订阅 xxx 不存在`、
 * pg 的唯一键冲突把整行键值都打出来、provisioning 的超时带上 request id）。所以这条
 * 铁律不能只靠「我们自己不写 uuid」，还得在**引入外部文本的那一刻**过一遍。
 *
 * 只抹 uuid 形状，不动其余：可视码（T-/U-/W-）、订单号、作业名、pg 的 SQLSTATE 全都
 * 要留着——那些正是运营据以定位的东西，抹多了通告就没用了。
 *
 * 抹在**截断之前**：先截后抹会把一个正好被切开的 uuid 留下半截（半截仍然是一串没人
 * 看得懂、也搜不到的十六进制）。
 */
export function redactUuids(text: string): string {
  return text.replace(UUID_IN_TEXT_RE, UUID_REDACTED_MARK);
}

/**
 * 写一条运营通告。**永不抛**：去重命中（inserted: false）不是错误，写失败也只记日志。
 *
 * label 进日志，用来说清丢的是哪一条——「写通告失败」本身没有信息量，等于没记。
 */
export async function writeOpsNotice(
  notices: SystemNoticeWriter,
  input: CreateSystemNoticeInput,
  logger: OpsNoticeLogger,
  label: string,
): Promise<void> {
  try {
    await notices.createSystemNotice(input);
  } catch (err) {
    logger.warn(`运营通告写入失败（${label}）— ${String(err)}`);
  }
}

/**
 * 租户可视码 + 日常显示名。display_name 是日常展示名，空则回落认证名 name
 * （与 operator-mirror 的 MIRROR_TENANT_SQL 同一口径）；tenant_no 是 bigint，
 * 转 text 免得 pg 交回 string 还是 number 要猜。
 *
 * **导出仅为可测**：假 pool 不解析 SQL，谓词只能靠字面断言钉住。
 */
export const OPS_NOTICE_TENANT_SQL = `select tenant_no::text as tenant_no,
              coalesce(nullif(display_name, ''), name) as tenant_name
         from tenancy.tenants
        where id = $1`;

/** 工作空间 → 它的租户可视码、租户名与空间名。配额那条通告要三样都说。 */
export const OPS_NOTICE_WORKSPACE_SQL = `select t.tenant_no::text as tenant_no,
              coalesce(nullif(t.display_name, ''), t.name) as tenant_name,
              w.name as workspace_name
         from tenancy.workspaces w
         join tenancy.tenants t on t.id = w.tenant_id
        where w.id = $1`;

export interface OpsNoticeTenant {
  readonly no: string | null;
  readonly name: string | null;
}

export interface OpsNoticeWorkspaceSubject extends OpsNoticeTenant {
  readonly workspaceName: string | null;
}

/** 查不到 / 查炸了都回三个 null——通告照发，只是少一个名字。 */
export async function resolveOpsNoticeTenant(
  pool: Pool,
  tenantId: string,
  logger: OpsNoticeLogger,
): Promise<OpsNoticeTenant> {
  try {
    const res = await pool.query<{
      tenant_no: string | null;
      tenant_name: string | null;
    }>(OPS_NOTICE_TENANT_SQL, [tenantId]);
    const row = res.rows[0];
    return { no: row?.tenant_no ?? null, name: row?.tenant_name ?? null };
  } catch (err) {
    logger.warn(`运营通告的租户可视码解析失败 — ${String(err)}`);
    return { no: null, name: null };
  }
}

export async function resolveOpsNoticeWorkspace(
  pool: Pool,
  workspaceId: string,
  logger: OpsNoticeLogger,
): Promise<OpsNoticeWorkspaceSubject> {
  try {
    const res = await pool.query<{
      tenant_no: string | null;
      tenant_name: string | null;
      workspace_name: string | null;
    }>(OPS_NOTICE_WORKSPACE_SQL, [workspaceId]);
    const row = res.rows[0];
    return {
      no: row?.tenant_no ?? null,
      name: row?.tenant_name ?? null,
      workspaceName: row?.workspace_name ?? null,
    };
  } catch (err) {
    logger.warn(`运营通告的工作空间解析失败 — ${String(err)}`);
    return { no: null, name: null, workspaceName: null };
  }
}
