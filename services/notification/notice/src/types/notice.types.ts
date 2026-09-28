/**
 * notice.types.ts — 运营通告的共享词汇。
 * @package @vxture/service-notice
 * @layer Domain
 * @category Types
 *
 * 平面代号与严重度原本在 opera-bff 与 admin-bff 各写了一份。它们是**表上的
 * CHECK 约束在代码里的投影**，只该有一处：`admin.operator_notices` 的
 * `chk_operator_notices_planes` / `chk_operator_notices_severity`。
 */

/**
 * 运营平面。与三个 BFF 的 `PLANE_ROOT` 前缀同一套。
 *
 * 表上 `chk_operator_notices_planes` 兜底（`target_planes <@ ARRAY[...]`），
 * 这里是同一组值的 TypeScript 侧。加平面时两处一起改——加了这边没加那边，
 * 插入会吃一条 23514；加了那边没加这边，新平面在读侧永远匹配不上。
 */
export const NOTICE_PLANES = ["admin", "opera", "arche"] as const;
export type NoticePlane = (typeof NOTICE_PLANES)[number];

/** 严重度三档。表上 `chk_operator_notices_severity` 兜底。 */
export const NOTICE_SEVERITIES = ["info", "warning", "critical"] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/** 来源。`manual` = 人手发布；`system` = 事件侧直接写库，不走发布路由。 */
export type NoticeSource = "manual" | "system";

/**
 * 读侧看到的一条通告。
 *
 * 比写侧（opera 发布面）少 `targetPlanes` / `expiresAt` / `createdAt` 三项：
 * 读的人不需要知道这条通告还发给了谁、什么时候过期——**过期的根本不会出现在
 * 列表里**，投递范围也已经由查询谓词兑现过了。回传它们只会让接收端多出一组
 * 可以据以自行过滤的字段，而那正是应该只发生在一处的判断。
 *
 * **不含 `createdBy` 那个 uuid**——全站规则：任何场景不展示 UUID。发布人只回
 * 显示名，账号注销后读不到则为 null，由前端画「—」。
 */
export interface OperatorNoticeView {
  readonly id: string;
  readonly severity: NoticeSeverity;
  readonly title: string;
  readonly body: string;
  readonly link: string | null;
  readonly source: NoticeSource;
  readonly publishedAt: string;
  /** 本人读过的时刻；null = 未读。 */
  readonly readAt: string | null;
  /** 发布人显示名；system 来源与已注销账号都回 null。 */
  readonly createdByName: string | null;
}

/**
 * 读侧筛选。**每一项都是可选的，给了才长出一条谓词**（见 `buildListQuery`）。
 *
 * 为什么不用「$n 恒在谓词里、由 null 关掉」那一手（LIST 的 `$3::bool` 就是那么写的）：
 * 那一手成立的前提是关掉的写法和打开的写法是同一个表达式。`severity = any($n)` 与
 * `title ilike $n` 都做不到——关掉要多套一层 `coalesce` / `or $n is null`，读的人得先
 * 在脑子里代入 null 才知道它此刻拦不拦。于是这里换成显式拼装：**只拼谓词文本，值一律
 * 绑定**，谁也不进 SQL 串。拼装那一步有测试钉着「不给的那一项一个字都不出现」。
 *
 * 筛选是「在同一份数据里少看几行」，不是换一份数据：`plane` / `operatorId` / `digest`
 * 三项仍然不来自请求体，它们定的是这个人能看见哪一份。
 */
export interface NoticeFilters {
  /**
   * 严重度多选。空数组与不给等价（= 三档都要）。
   *
   * 它比另外三项**晚一步**生效：`counts` 那一排数字要在「除严重度以外都筛过」的集合
   * 上算，否则勾了「紧急」之后另两档恒为 0，那排数字就再也不能当入口用了。
   */
  readonly severities?: readonly NoticeSeverity[];
  /** 来源。人发的与系统播的常常要分开看——追一件事时只想看系统那一路。 */
  readonly source?: NoticeSource;
  /**
   * 只看未读。与 `digest` 可以同时给：摘要档留着「当天已读」，这一项把它收掉。
   * 两者不是一回事，所以不合并成一个开关。
   */
  readonly unreadOnly?: boolean;
  /** 标题或正文含它（ILIKE）。值绑定，`%` 与 `_` 已转义——见 `likePattern`。 */
  readonly keyword?: string;
}

/**
 * 读一页通告的入参。
 *
 * `plane` 与 `operatorId` **都不来自请求体**：平面是 BFF 自己的身份（它就是那个
 * 平面），运营者是会话里的人。两者任一可由调用方指定，这个接口就变成了一个
 * 「读别的平面 / 别人已读状态」的探测面。
 */
export interface ListNoticesParams extends NoticeFilters {
  readonly plane: NoticePlane;
  readonly operatorId: string;
  /**
   * 摘要档：**当天已读 + 所有未读**（owner 2026-09-20 定）。
   *
   * 为什么当天已读也要留：只列未读的话，刚点过「知道了」的那条会当场消失，
   * 运营者会以为自己点错了。留到当天结束是个温和的过渡。
   */
  readonly digest: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface ListNoticesResult {
  readonly items: OperatorNoticeView[];
  /** 当前档下的总条数（摘要档与全部档不是同一个数）。 */
  readonly total: number;
  /**
   * 未读数。**恒按「全部」算，不随 digest 变**——铃铛角标要的是「还有几条没看」，
   * 不是「本页列了几条」。
   */
  readonly unread: number;
  /**
   * 三档各有多少条（2026-09-28 第四批：前三批刻意把信号做全，这一批让它变得读得懂）。
   *
   * 口径：**除严重度以外的筛选都算上**。严重度自己那一维不参与——参与的话，勾了
   * 「紧急」之后「重要 0 / 一般 0」，而库里明明还有几十条，那排数字就从入口退化成
   * 当前筛选的回声。
   *
   * 它和 `total` / `unread` 一样**不跟着分页走**，而且**空页也报得出数**：三个计数由
   * 一条不带 limit/offset 的汇总语句出（`buildListQuery.summarySql`）。写成页行的附加列
   * 的话，筛出 0 条时整排数字会一起变成 0——而那正是最需要看见「别的档还有几条」的
   * 时候。
   */
  readonly counts: NoticeSeverityCounts;
}

/** 三档各自的条数。键是 `NoticeSeverity` 的全集，不缺档——缺档会被读成 0。 */
export type NoticeSeverityCounts = Readonly<Record<NoticeSeverity, number>>;

/** 标记已读的结果。`null` = 通告不存在或已撤回。 */
export interface MarkNoticeReadResult {
  readonly id: string;
  readonly readAt: string;
}

/**
 * 「全部标记已读」的结果。
 *
 * `marked` = 本次真的从未读变成已读的条数，不是「可见的总条数」。它要能回答「刚才那
 * 一下管到了几条」——已经读过的不算，0 条也是个合法答案（角标本来就是 0）。
 */
export interface MarkAllNoticesReadResult {
  readonly marked: number;
}

/**
 * 系统来源通告的写入参数（2026-09-28，owner：「用户订阅的退款、退订，admin 平台一条
 * 消息都没有」）。
 *
 * 与 opera 的人工发布面是**两条写路**：人发的没有去重锚（同一件事可以发两条，那是他的
 * 判断）；系统发的必须带 `referenceType` + `referenceId`，表上 `chk_operator_notices_reference`
 * 强制这一点，`uq_operator_notices_system` 保证**一事一条**——事件侧重放、作业重扫都
 * 只会落成一次 `inserted: false`，不会刷屏。
 *
 * `targetPlanes` 空数组 = 三个平面都可见（与读侧谓词同一约定）。
 */
export interface CreateSystemNoticeInput {
  readonly targetPlanes: readonly NoticePlane[];
  readonly severity: NoticeSeverity;
  readonly title: string;
  readonly body: string;
  /** 平面内相对路径（点开去哪）；没有就 null。 */
  readonly link?: string | null;
  /** 去重锚：业务对象类别（如 `refund`、`subscription_cancelled`）。 */
  readonly referenceType: string;
  /** 去重锚：业务对象标识。**用可视码**（refund_no）或不展示的内部 id 都可以——它不上屏。 */
  readonly referenceId: string;
  /** 到期即退出列表，不删行；缺省不过期。 */
  readonly expiresAt?: Date | null;
}

/**
 * `inserted: false` = 同一去重锚已有一条未撤回的系统通告，本次没写（不是错误）。
 * `id` 只在 inserted 时有值——`on conflict do nothing` 不回行。
 */
export interface CreateSystemNoticeResult {
  readonly inserted: boolean;
  readonly id: string | null;
}
