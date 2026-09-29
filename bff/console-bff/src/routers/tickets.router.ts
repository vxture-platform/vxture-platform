/**
 * tickets.router.ts — 客户侧工单（列表 / 详情+时间线 / 建单 / 回复 / 重新打开）。
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 写入侧上周先在运营面落了地（admin-bff 的 tickets.router：代客建单、内部备注与
 * 正式回复分离、显式关闭、那道可见性守卫）。这一批补的是**客户自己那一面**：
 * 在此之前 console 既没有工单路由也没有工单模块，客户唯一的求助通道是官网上的
 * 一个邮箱地址。表与字段全部沿用运营面写入的那两张表，不另建模型。
 *
 * 契约的另一半在 `portals/console/src/api/console-bff.ts`（`ConsoleTicket` /
 * `ConsoleTicketEvent` / `ConsoleTicketDetail`）与
 * `portals/console/src/lib/ticket-state.ts`（七个状态各自还能做什么）。
 * 路径、字段名、返回形状都按那一份对齐——两边各自发明一套的代价这条线已经付过。
 *
 * ── 五条不许动的口径 ──
 * ① **租户级可见**（owner 2026-09-29 裁决一）：同租户成员都看得见本租户的工单，
 *    不是「我提的我才看得见」。所以每条查询只按 `tenant_id` 过滤、**不按
 *    account_id 过滤**；而 tenant **只从会话取**（`req.tenant.id`），请求体、
 *    查询串、路径里的任何租户标识一概不认。
 * ② **一律按可视码寻址**：路径参数、请求体、响应体里只出现 `ticket_no`。
 *    下面每条 SQL 都只匹配 `t.ticket_no`，**刻意不像运营面那样兼容 `id::text`**——
 *    少一条 uuid 进得来的路，就少一条它出得去的路（uuid 禁展示，owner 2026-08-20）。
 *    响应体里一个 uuid 都没有，连时间线的 React key 都不是（时间线仅追加、升序、
 *    不重排，门户用下标当 key）。
 * ③ **别人租户的单号 = 404，不是 403**：403 等于承认「这张单存在，只是不归你」，
 *    那就成了拿单号探测别家工单存在与否的接口。查不到与不归你是同一个回答。
 * ④ **时间线必须按 `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 过滤**（白名单、绑参，
 *    值域权威在 @vxture-platform/shared）。漏掉它的后果是运营的内部备注直接
 *    渲染在客户的工单页上，而这种漏法**不抛异常、不报 500、页面看起来完全正常**
 *    ——直到客户把那句内部话引用回来。lint:ticket-visibility 会拦，但这里当它
 *    不存在也要写对。
 * ⑤ **「最后一次动静」也只数客户看得见的事件**：不用 `tickets.updated_at`。
 *    运营写一条内部备注也会推进 updated_at，拿它当动静时刻，客户会看到
 *    「10 分钟前有动静」，点进去时间线一个字没变——那个数字本身就在泄露内部活动。
 *
 * ── 投影是**窄投影**，不整段转发 payload ──
 * `support.ticket_comments.payload` 是开放的 jsonb，运营面确实往里写过 uuid
 * （assign 事件的 assignee_id）。所以客户面不写 `payload: row.payload` 这种整体
 * 转发，只取这一屏用得到的那两项（正文 / 状态落点）。将来谁往某个**可见**事件的
 * payload 里塞了 uuid，也到不了浏览器。
 *
 * ── 客户不设优先级、不设分类 ──
 * 见 createTicket 的头注：客户说「这很急」是**主张**，不是事实；队列次序是我方
 * 的排班。两者都不收，收到了就 400——不是静默忽略（静默忽略会让门户那边长出
 * 一个按了没反应的假控件）。读是另一回事：两列都照常下发，页面要展示随它。
 */
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import {
  CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
  TICKET_EVENT_COMMENT,
} from "@vxture-platform/shared";
import type {
  CustomerVisibleTicketEventType,
  TicketStatus,
} from "@vxture-platform/shared";
import type { RequestContext } from "../types/console.types";
import { SelfScope } from "../auth/capability";

/**
 * 绑给 SQL 的可见事件值域。**一份权威值域的可变副本**，不是第二份清单——
 * 它就是 `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 本身（`readonly` 展开一次给 pg
 * 当参数用）。客户面每一条读取都绑它，绝不在 SQL 里手抄词。
 */
const VISIBLE_TICKET_EVENT_TYPES: string[] = [
  ...CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
];

/**
 * 客户自己发言的事件词，与运营的 `internal_note` / `reply` 并列在同一条时间线上。
 *
 * 类型标成 `CustomerVisibleTicketEventType` 是**编译期的钉子**：哪天有人把
 * `comment` 从白名单里挪走，这一行当场编译不过。客户自己说的话不可能用一个
 * 客户读不到的词写进去——这件事不靠人记得。
 */
const TICKET_EVENT_CUSTOMER_COMMENT: CustomerVisibleTicketEventType =
  TICKET_EVENT_COMMENT;

/** 状态变更事件（重新打开会写它）。同上，类型把它钉在白名单里。 */
const TICKET_EVENT_STATUS_CHANGED: CustomerVisibleTicketEventType =
  "status_changed";

/**
 * 建单事件。**刻意不在白名单里**（与运营面同一个词、同一个理由）：建单这件事
 * 由工单自己的 created_at 回答一次就够，而这一行带着 source 这类内部口径。
 */
const TICKET_EVENT_CREATED = "created";

/**
 * 客户还能接着说话的状态（回复框开着）：未结那四个 + `resolved`。
 *
 * 加 `resolved` 是因为客户收到的通知就是这么许诺的（`ticket.resolved` 正文：
 * 「如果问题还在，在那里回复一句，我们接着处理」），而 `resolved` 是**对答案的
 * 判断**、可逆。终态用**补集**定义（见 isTerminal），不另列一份 closed/cancelled：
 * 值域将来多一个词，它自动落到「不能回复」这一边——那是保守的一边。
 *
 * 这份分组与门户的 `portals/console/src/lib/ticket-state.ts` 是同一套判据
 * （判据只有一个：状态）。两侧各存一份是今天的实际情况——BFF 不能 import 门户的
 * lib，而值域权威 @shared 里只有七个值、没有这个分组。**收进 @shared 是 follow-up**，
 * 在那之前两侧都用 `TicketStatus` 把「漏了一个值」变成编译错误。
 */
const REPLYABLE_TICKET_STATUSES: readonly TicketStatus[] = [
  "open",
  "pending",
  "in_progress",
  "reopened",
  "resolved",
];

/** 「我方认为已解决」——客户在这个状态下回复，等于说「没好」，见 addReply。 */
const TICKET_STATUS_RESOLVED: TicketStatus = "resolved";
/** 重新打开后的状态（会清掉 resolved_at / closed_at）。 */
const TICKET_STATUS_REOPENED: TicketStatus = "reopened";

/**
 * `support.tickets.source` 在「客户自助提单」这条路径上的取值（值域见
 * chk_tickets_source）。运营代客录入取 'admin'，客户自己提取 'console'——
 * 这一列答的是「这行是从哪个渠道进来的」，日后按它统计自助率时两条路径分得开。
 */
const TICKET_SOURCE_SELF_SERVICE = "console";

/** 正文上限：与运营面同一口径（description/body 都是 text 列）。 */
const MAX_BODY_LEN = 10000;
/** 标题列是 varchar(200)。 */
const MAX_TITLE_LEN = 200;
/** reporter_name 列是 varchar(100)。 */
const MAX_REPORTER_LEN = 100;

/**
 * 列表一次返回的上限。客户看的是自己租户的单，量级是几十，所以**一次拉完、
 * 不分页**（门户的抽屉与列表页都按状态在客户端分组，与收件箱同一取舍）。
 * 上限写在这里：真有租户逼近 200 张单，再上游标分页。
 *
 * 而「别让它静悄悄地截断」不能只是一句注释：列表按最后一次可见动静倒序，
 * 截掉的恰好是最久没动的那些——里面可能真有没关的单，而抽屉跟列表页都是在
 * 这一页上再筛的 ⇒ 屏幕上看不出来。所以多拉一行（`MAX_TICKETS + 1`），多出来那一行
 * 只用来**当场记一条 warn**（不进响应，契约是裸数组）：那一天到了日志里有话，
 * 而不是等客户来问「我那张单哪去了」。游标分页仍是真正的修法（已写进跟进）。
 */
const MAX_TICKETS = 200;

/**
 * 单号形状。**刻意宽松**：只拦空 / 过长 / 带怪字符，不去校验
 * `TK-YYYYMM-XXXXXXXXXX` 那个具体格式——格式的权威在生成它的那一侧，
 * 这里写死一遍就等于第二份格式定义，运营面改了格式客户面当天全部 400。
 * uuid 也能通过这道形状（它也是字母数字加连字符），但下面每条 SQL 都只匹配
 * `ticket_no`，所以 uuid 永远解析不出工单 ⇒ 404。
 */
const TICKET_CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

// ── 响应形状（一个 uuid 都没有；与 portals/console 的同名接口对齐）──────────

/** 一张工单，客户视角。没有 id、没有 tenantCode——两者在这一侧都没有用途。 */
export interface ConsoleTicket {
  /** 可视工单码（`TK-{YYYYMM}-{10}`）。路由、列表、通知三处用的是同一串。 */
  ticketNo: string;
  title: string;
  /** `support.tickets.status` 的七值之一，标签由门户翻。 */
  status: string;
  priority: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 报单人姓名（`tickets.reporter_name`）。
   *
   * 可见范围是**租户级**（owner 裁决 1），所以这一列答的是「同事里谁提的」
   * ——没有它，一个成员看到的就是一堆无主的单。运营代客建单时这里是运营
   * 录的那个名字，所以 admin 那个输入框得带「客户可见」徐标（同一批里加上了）。
   */
  reporterName: string;
  /** 最后一次**客户看得见**的动静的时刻；一条可见流水都没有则 null（见口径⑤）。 */
  lastActivityAt: string | null;
  /** 那条动静的 `event_type`（开放集，门户认不出的值只说时间不说事由）。 */
  lastActivityEventType: string | null;
}

/** 时间线上的一条流水，客户视角。**只可能是白名单里的事件类型**。 */
export interface ConsoleTicketEvent {
  eventType: string;
  /** `customer` | `operator` | `system`。 */
  actorType: string;
  actorName: string;
  /** 正文；状态事件没有说明时为 null。 */
  body: string | null;
  /** 状态事件的落点；其余事件为 null。 */
  status: string | null;
  createdAt: string;
}

export interface ConsoleTicketDetail extends ConsoleTicket {
  /** 建单时写下的问题描述（`tickets.description`，不是一条流水）。 */
  description: string;
  events: ConsoleTicketEvent[];
}

// ── SQL ─────────────────────────────────────────────────────────────────────

/**
 * 列表。排序键是**客户看得见的最后一次动静**，取不到就退回建单时刻
 * （`coalesce(...)`）——不用 `t.updated_at`：那一列被运营的内部动作推进，
 * 拿它排序会让列表因为客户看不见的事重排（口径⑤）。
 *
 * 那条横向连接读 `support.ticket_comments`，`$2` 绑
 * CUSTOMER_VISIBLE_TICKET_EVENT_TYPES（白名单，绝不在 SQL 里手抄词）。
 */
const TICKET_LIST_SQL = `
select
  t.ticket_no,
  t.title,
  t.status,
  t.priority,
  t.category,
  t.description,
  t.created_at,
  t.updated_at,
  t.reporter_name,
  last_visible.event_type as last_activity_event_type,
  last_visible.created_at as last_activity_at
from support.tickets t
left join lateral (
  select c.event_type, c.created_at
  from support.ticket_comments c
  where c.ticket_id = t.id
    and c.event_type = any($2::text[])
  order by c.created_at desc, c.id asc
  limit 1
) last_visible on true
where t.tenant_id = $1::uuid
  and t.deleted_at is null
order by coalesce(last_visible.created_at, t.created_at) desc, t.ticket_no desc
limit $3
`;

/** 一行：按可视码 + 会话租户取。两者缺一 ⇒ 0 行 ⇒ 404（见口径③）。 */
const TICKET_ONE_SQL = `
select
  t.ticket_no,
  t.title,
  t.status,
  t.priority,
  t.category,
  t.description,
  t.created_at,
  t.updated_at,
  t.reporter_name,
  last_visible.event_type as last_activity_event_type,
  last_visible.created_at as last_activity_at
from support.tickets t
left join lateral (
  select c.event_type, c.created_at
  from support.ticket_comments c
  where c.ticket_id = t.id
    and c.event_type = any($3::text[])
  order by c.created_at desc, c.id asc
  limit 1
) last_visible on true
where t.ticket_no = $1
  and t.tenant_id = $2::uuid
  and t.deleted_at is null
limit 1
`;

/**
 * 时间线（升序，append-only 事件流）。
 *
 * `c.event_type = any($3::text[])` 绑的是 CUSTOMER_VISIBLE_TICKET_EVENT_TYPES
 * ——**这是整个文件里最要紧的一行**。它是白名单：`event_type` 是开放集
 * （varchar(64)，无 CHECK），将来冒出的新词默认看不见；写成「排除 internal_note」
 * 的黑名单方向，今天也挡得住，但下一个新词会默认放行，而默认放行正是会泄露的
 * 那个方向。
 */
const TICKET_TIMELINE_SQL = `
select c.event_type, c.actor_type, c.actor_name, c.payload, c.created_at
from support.ticket_comments c
join support.tickets t on t.id = c.ticket_id
where t.ticket_no = $1
  and t.tenant_id = $2::uuid
  and t.deleted_at is null
  and c.event_type = any($3::text[])
order by c.created_at asc, c.id asc
`;

/**
 * 建单。派生列全走列默认值：`category`='general'、`priority`='p2'、
 * `status`='open'（客户设不了后两个，见 createTicket 头注）。
 * 返回的 uuid 只在同事务里给建单事件当外键用，**不进响应体**。
 */
const TICKET_INSERT_SQL = `
insert into support.tickets
  (tenant_id, account_id, ticket_no, source, title, description, reporter_name)
values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
returning id, ticket_no, title, status, priority, category, description,
          created_at, updated_at
`;

/**
 * 事务内按 (可视码, 会话租户) 锁住工单行。0 行同时覆盖「没有这张单」与
 * 「这张单不归你」——两者一个回答（404），见口径③。
 */
const TICKET_LOCK_SQL = `
select id, status
from support.tickets
where ticket_no = $1
  and tenant_id = $2::uuid
  and deleted_at is null
for update
`;

/**
 * 客户来了一句话 ⇒ 这张单有了新动静。
 *
 * `updated_at` 是**两个读者共用的一列**，而两边要的方向相反，所以这里说清楚：
 *   · admin 工单列表按 `order by priority, updated_at desc` —— bump 让客户的话浮到前面，
 *     这是要的；不 bump 就沉在原位。
 *   · ops-todos 未超时时取 `waiting_since = updated_at`，而它按 `waiting_since asc` 排序
 *     并按它升档 ⇒ bump 在那一面是**往后挤**。
 * 所以客户回复的运营信号**不靠这一列**：靠 platform-api 巡检的
 * `ticket.customer_replied` 单发一条不过期的运营通告。排序那一层的取值语义要改
 * 得动 ops-todos 那条唯一算法，不在本批自决（已写进跟进）。
 * 锚点列（id / ticket_no / created_at）一个不碰——生产上 platform_svc 对它们
 * 没有 UPDATE 权限，碰一下整条事务 42501 回滚。
 */
const TICKET_TOUCH_SQL = `
update support.tickets
set updated_at = now()
where id = $1::uuid
`;

/**
 * 重新打开：清掉 resolved_at 与 closed_at（这两个时刻已经不成立了），
 * 状态走 `$2` 绑参。同上，不碰锚点列。
 */
const TICKET_REOPEN_SQL = `
update support.tickets
set status = $2::text,
    resolved_at = null,
    closed_at = null,
    updated_at = now()
where id = $1::uuid
`;

/**
 * 写一条流水。`actor_type` 在 SQL 里写死 'customer' 而不做参数：这个文件是客户面，
 * 它写不出别的身份——留成参数就等于给「客户面冒充运营写一条 reply」留了个形状。
 *
 * `created_at` 用 `clock_timestamp()` 而不是列默认的 `now()`：`now()` 在一个事务里
 * 是**常量**，一次调用要写两行时（回复一张已解决的单：客户那句话 + 状态变更）
 * 两行会撞成同一微秒，时间线的排序就退化成随机 uuid 的先后——客户每刷新一次
 * 可能看到不同的顺序。clock_timestamp() 每条语句各取一次真实时钟，先后是真的。
 */
const TICKET_EVENT_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload, created_at)
values ($1::uuid, $2::text, 'customer', $3::uuid, $4, $5::jsonb, clock_timestamp())
returning event_type, actor_type, actor_name, payload, created_at
`;

// ── 行类型 ───────────────────────────────────────────────────────────────────

interface TicketRow {
  ticket_no: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  description: string;
  created_at: Date;
  updated_at: Date;
  reporter_name: string;
  last_activity_event_type: string | null;
  last_activity_at: Date | null;
}

interface TicketEventRow {
  event_type: string;
  actor_type: string;
  actor_name: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

interface CreateTicketBody {
  title?: unknown;
  description?: unknown;
  /** 收下只为报错：客户不定优先级（见 createTicket 头注）。 */
  priority?: unknown;
  /** 同上：分类是我方的路由口径。 */
  category?: unknown;
}

interface TicketReplyBody {
  body?: unknown;
}

interface ReopenTicketBody {
  reason?: unknown;
}

@SelfScope()
@Controller("api/support/tickets")
export class TicketsRouter {
  /* 注入的东西只有 pool；logger 是字段而不是构造参数——上面那条
     「必须显式 @Inject」的坐陷只对构造参数成立，把 Logger 也挤进参数表
     只会给下一个人多一个要判的东西。 */
  private readonly logger = new Logger(TicketsRouter.name);

  constructor(
    // 必须显式 @Inject：打包走 esbuild，它不产 emitDecoratorMetadata，
    // 靠参数类型推断的注入在运行时拿到 undefined，而 tsc 与单测都看不见。
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  /**
   * 会话身份。租户**只从这里取**，任何入参里的租户标识都不看。
   * `@SelfScope` 只保证有会话，不保证有租户上下文，所以这里自己判一次。
   */
  private session(req: Request & RequestContext): {
    accountId: string;
    tenantId: string;
    actorName: string;
  } {
    if (!req.user) throw new UnauthorizedException("会话不存在");
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const name =
      req.user.displayName?.trim() ||
      req.user.name?.trim() ||
      req.user.username?.trim() ||
      "客户";
    return {
      accountId: req.user.id,
      tenantId: req.tenant.id,
      actorName: name.slice(0, MAX_REPORTER_LEN),
    };
  }

  /**
   * Contract: GET /api/support/tickets
   *   response: ConsoleTicket[]（本租户的单，最后一次**可见**动静在最前）。
   *
   * 每行都带 lastActivityAt / lastActivityEventType，抽屉与列表页都不必再逐行
   * 发第二个请求。不分页（见 MAX_TICKETS）。
   */
  @Get()
  async list(@Req() req: Request & RequestContext): Promise<ConsoleTicket[]> {
    const { tenantId } = this.session(req);
    /* 多拉一行探上限（见 MAX_TICKETS）。响应只给前 MAX_TICKETS 行，
       多出来那一行只用来记一条 warn。 */
    const res = await this.pool.query<TicketRow>(TICKET_LIST_SQL, [
      tenantId,
      VISIBLE_TICKET_EVENT_TYPES,
      MAX_TICKETS + 1,
    ]);
    if (res.rows.length > MAX_TICKETS) {
      this.logger.warn(
        `租户的工单数超过列表上限 ${MAX_TICKETS}，这一页之外的单客户看不到` +
          `（含抽屉里的未关闭项，它们是在这一页上再筛的）。该上游标分页了。`,
      );
    }
    return res.rows.slice(0, MAX_TICKETS).map(mapTicket);
  }

  /**
   * Contract: GET /api/support/tickets/:code
   *   response: ConsoleTicketDetail（工单 + 客户看得见的时间线，升序）。
   *   404：没有这张单、已软删、或它属于别的租户（同一个回答，见口径③）。
   *
   * 两条查询按顺序走：先解出工单，解不出**直接 404，不去读时间线**。
   */
  @Get(":code")
  async detail(
    @Req() req: Request & RequestContext,
    @Param("code") codeRaw: string,
  ): Promise<ConsoleTicketDetail> {
    const { tenantId } = this.session(req);
    const code = requireTicketCode(codeRaw);
    const ticket = await this.fetchTicket(code, tenantId);
    const events = await this.pool.query<TicketEventRow>(TICKET_TIMELINE_SQL, [
      code,
      tenantId,
      VISIBLE_TICKET_EVENT_TYPES,
    ]);
    return {
      ...mapTicket(ticket),
      description: ticket.description,
      events: events.rows.map(mapEvent),
    };
  }

  /**
   * Contract: POST /api/support/tickets
   *   body: { title, description }
   *   response: ConsoleTicket。400 标题/正文缺失或超长、或送了 priority /
   *   category；409 单号撞号（重试即可）。
   *
   * ── 谁提的、从哪来 ──
   * `source`='console'（客户自己提的，与运营代录的 'admin' 分得开，日后统计自助率
   * 靠这一列）；`account_id` = 会话账号，`reporter_name` = 会话显示名。
   * 两者都不从请求体取——那等于让调用方决定这张单署谁的名。
   *
   * ── 客户不定优先级：那是主张，不是事实 ──
   * `priority` 决定这张单在队列里插到哪，是**我方的排班**。让报单人自己填，结果
   * 只有一个：所有单都是最高档，那一列当天失去分辨力。所以不收。
   * 收到了报 400 而**不是静默忽略**：静默忽略会让门户那边长出一个「紧急程度」
   * 选择器，选了没反应、也没人知道它没反应——一个假控件比没有控件更糟。
   * 真的很急，写在正文里；急不急由看单的人判断。
   * `category` 同理：它是运营的路由分类（开放分类法，今天全库只有默认值
   * 'general'），客户面不认领一个值域，也不在这一批凭空造一套客户分类词。
   *
   * ── 为什么不把正文再写一条时间线事件 ──
   * 建单正文存在 `tickets.description`，详情页从工单本身读它。再往
   * ticket_comments 里写一条 `comment`，客户就会在同一屏看到自己那段话两遍。
   * 时间线只装「之后发生的事」。建单这件事仍写一条 `created` 事件（客户看不见，
   * 与运营面同一个词），运营那边的时间线因此照样有第一行。
   */
  @Post()
  async createTicket(
    @Req() req: Request & RequestContext,
    @Body() body: CreateTicketBody,
  ): Promise<ConsoleTicket> {
    const { accountId, tenantId, actorName } = this.session(req);
    rejectOperatorOnlyField(body?.priority, "priority", "紧急程度由客服判断");
    rejectOperatorOnlyField(body?.category, "category", "分类由客服归档");
    const title = requireText(body?.title, "title", MAX_TITLE_LEN);
    const description = requireText(
      body?.description,
      "description",
      MAX_BODY_LEN,
    );

    return this.inTransaction(async (client) => {
      let created: TicketRow & { id: string };
      try {
        const inserted = await client.query<TicketRow & { id: string }>(
          TICKET_INSERT_SQL,
          [
            tenantId,
            accountId,
            ticketCode(),
            TICKET_SOURCE_SELF_SERVICE,
            title,
            description,
            actorName,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new ConflictException("建单失败，请重试");
        created = row;
      } catch (error) {
        // 单号是随机 10 位 + 唯一约束（uq_tickets_ticket_no）兜底。撞号概率是
        // 天文数字级的小，但撞上时要是一句看得懂的 409，不是裸 500。
        if (pgErrorCode(error) === "23505") {
          throw new ConflictException("单号冲突，请重试");
        }
        throw error;
      }

      await client.query(TICKET_EVENT_INSERT_SQL, [
        created.id,
        TICKET_EVENT_CREATED,
        accountId,
        actorName,
        JSON.stringify({ source: TICKET_SOURCE_SELF_SERVICE }),
      ]);
      // 新单还没有任何客户可见流水 ⇒ lastActivity 两项是 null，不必回查一次。
      return mapTicket({
        ...created,
        last_activity_event_type: null,
        last_activity_at: null,
      });
    });
  }

  /**
   * Contract: POST /api/support/tickets/:code/comments
   *   body: { body: string }
   *   response: ConsoleTicketEvent（刚追加的那一条）。
   *   404 不存在/不归本租户；400 正文缺失或超长；409 工单已终结（见下）。
   *
   * 事件类型由**服务端**决定（客户发言那个词），客户端不送 `event_type`——
   * 那会让「这句话给谁看」变成一个能从浏览器篡改的参数。
   *
   * ── 终态不收回复 ──
   * `closed` / `cancelled` 下回复报 409，让客户走 `:code/reopen`——那条路把
   * 「重新打开」和他这句话一次做完，话不会白打。门户按状态决定显示输入框还是
   * 「重新打开」（`ticket-state.ts`，与这里同一套判据），正常不会有人先写完再吃 409。
   *
   * ── 「我方认为已解决」的单被回复 ⇒ 自动重新打开 ──
   * `resolved` 是**对答案的判断**，可逆。客户在这个状态下再说话，说的就是
   * 「没好」——留在 resolved 的下场是：运营的「待处理」筛选里它已经不在了，
   * 而巡检发出的那条通告里写的状态会是「已解决」——一句自相矛盾的话。所以同一个
   * 事务里把状态改成 `reopened`、清掉 resolved_at，并写一条客户看得见的
   * `status_changed`。沉默不是答案。
   * 副作用（门户注意）：这一响应只带那条流水，状态已经变了——回复成功后要么
   * 重取详情，要么按「可能已重新打开」处理，别用回复前的 status 继续画页面。
   *
   * 其余状态（open / pending / in_progress / reopened）只 bump `updated_at`。
   * 这一下只让 admin 工单列表（`updated_at desc`）把它提到前面；**真正的运营信号**是
   * platform-api 巡检的 `ticket.customer_replied`（一句回复一条不过期的通告）。
   * 两者的分工与 `updated_at` 在 ops-todos 那一面的反方向效果，见 TICKET_TOUCH_SQL 的头注。
   */
  @Post(":code/comments")
  async addReply(
    @Req() req: Request & RequestContext,
    @Param("code") codeRaw: string,
    @Body() body: TicketReplyBody,
  ): Promise<ConsoleTicketEvent> {
    const { accountId, tenantId, actorName } = this.session(req);
    const code = requireTicketCode(codeRaw);
    const text = requireText(body?.body, "body", MAX_BODY_LEN);

    return this.inTransaction(async (client) => {
      const ticket = await lockTicket(client, code, tenantId);
      if (isTerminal(ticket.status)) {
        throw new ConflictException("工单已结束，请先重新打开再继续");
      }

      const appended = await client.query<TicketEventRow>(
        TICKET_EVENT_INSERT_SQL,
        [
          ticket.id,
          TICKET_EVENT_CUSTOMER_COMMENT,
          accountId,
          actorName,
          JSON.stringify({ body: text }),
        ],
      );
      const event = appended.rows[0];
      if (!event) throw new ConflictException("回复未能写入，请重试");

      if (ticket.status === TICKET_STATUS_RESOLVED) {
        await client.query(TICKET_REOPEN_SQL, [
          ticket.id,
          TICKET_STATUS_REOPENED,
        ]);
        await client.query(TICKET_EVENT_INSERT_SQL, [
          ticket.id,
          TICKET_EVENT_STATUS_CHANGED,
          accountId,
          actorName,
          JSON.stringify({
            from: ticket.status,
            to: TICKET_STATUS_REOPENED,
          }),
        ]);
      } else {
        await client.query(TICKET_TOUCH_SQL, [ticket.id]);
      }
      return mapEvent(event);
    });
  }

  /**
   * Contract: POST /api/support/tickets/:code/reopen
   *   body: { reason: string }   —— 必填，就是客户接着要说的那句话。
   *   response: ConsoleTicket（刷新后）。
   *   404 不存在/不归本租户；400 reason 缺失或超长；409 工单还没结束。
   *
   * ── 那句话客户和我们都读得到 ──
   * 它写进 `status_changed` 的 payload（`note`），而 `status_changed` 在客户可见
   * 白名单里 ⇒ 时间线上就是「重新打开：<那句话>」。与运营关闭时那句 reason
   * 走的是同一条路、同一个读者，不是一个只给内部看的理由框。
   * 只写**一条**流水而不是「状态变更 + 一条发言」：两行同事务、语义上是同一件事，
   * 拆成两行只会在时间线上多出一次重复，还得替它们编一个先后。
   *
   * ── 为什么必须带一句话 ──
   * 客户回头找上来，总是有新情况要说。把「重新打开」和那句话做成一次调用，
   * 门户上就是同一个输入框同一颗按钮：写完点「重新打开并继续」。拆成两步的话，
   * 客户会先写完、点发送、吃一个 409，然后被要求重新打开——那段话得再打一遍。
   *
   * ── 只从终态重新打开 ──
   * 还能回复的状态报 409「工单仍在处理中，直接回复即可」：那种情况客户要的就是
   * 回复，不是把一张活着的单标成「重新打开」（那会在时间线上留一条骗人的记录）。
   * 于是「能回复」与「能重新打开」恰好互补，门户永远只显示一个入口。
   */
  @Post(":code/reopen")
  async reopenTicket(
    @Req() req: Request & RequestContext,
    @Param("code") codeRaw: string,
    @Body() body: ReopenTicketBody,
  ): Promise<ConsoleTicket> {
    const { accountId, tenantId, actorName } = this.session(req);
    const code = requireTicketCode(codeRaw);
    const reason = requireText(body?.reason, "reason", MAX_BODY_LEN);

    await this.inTransaction(async (client) => {
      const ticket = await lockTicket(client, code, tenantId);
      if (!isTerminal(ticket.status)) {
        throw new ConflictException("工单仍在处理中，直接回复即可");
      }

      await client.query(TICKET_REOPEN_SQL, [
        ticket.id,
        TICKET_STATUS_REOPENED,
      ]);
      await client.query(TICKET_EVENT_INSERT_SQL, [
        ticket.id,
        TICKET_EVENT_STATUS_CHANGED,
        accountId,
        actorName,
        JSON.stringify({
          from: ticket.status,
          to: TICKET_STATUS_REOPENED,
          note: reason,
        }),
      ]);
    });

    return mapTicket(await this.fetchTicket(code, tenantId));
  }

  /** 按可视码 + 会话租户取一行；取不到就是 404（不区分不存在与不归你）。 */
  private async fetchTicket(
    code: string,
    tenantId: string,
  ): Promise<TicketRow> {
    const res = await this.pool.query<TicketRow>(TICKET_ONE_SQL, [
      code,
      tenantId,
      VISIBLE_TICKET_EVENT_TYPES,
    ]);
    const row = res.rows[0];
    if (!row) throw new NotFoundException("工单不存在");
    return row;
  }

  /** 事务样板（本仓 repository 同一写法）：begin / commit / rollback / release。 */
  private async inTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * 事务内解出工单。**这一步是租户隔离的落点**：谓词同时卡可视码与会话租户，
 * 0 行就抛 404，后面的写入一条都不执行（别人家的单号在这里就停下了）。
 */
async function lockTicket(
  client: PoolClient,
  code: string,
  tenantId: string,
): Promise<{ id: string; status: string }> {
  const res = await client.query<{ id: string; status: string }>(
    TICKET_LOCK_SQL,
    [code, tenantId],
  );
  const ticket = res.rows[0];
  if (!ticket) throw new NotFoundException("工单不存在");
  return ticket;
}

/** 终态 = 「还能回复」的补集：新冒出来的状态词默认落到保守的这一边。 */
function isTerminal(status: string): boolean {
  return !(REPLYABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

function requireTicketCode(code: string): string {
  if (typeof code !== "string" || !TICKET_CODE_RE.test(code.trim())) {
    throw new BadRequestException("工单编号无效");
  }
  return code.trim();
}

function requireText(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} 不能为空`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new BadRequestException(`${field} 超过 ${maxLen} 字`);
  }
  return trimmed;
}

/** 客户面不许设的字段：给了就 400，不静默丢（理由见 createTicket 头注）。 */
function rejectOperatorOnlyField(
  value: unknown,
  field: string,
  why: string,
): void {
  if (value === undefined || value === null || value === "") return;
  throw new BadRequestException(`${field} 不由提单人设置：${why}`);
}

/** 可视码：TK-{YYYYMM}-{10 位}，与运营面同形（唯一约束兜底防重）。 */
function ticketCode(): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `TK-${ym}-${suffix}`;
}

function pgErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function mapTicket(row: TicketRow): ConsoleTicket {
  return {
    ticketNo: row.ticket_no,
    title: row.title,
    status: row.status,
    priority: row.priority,
    category: row.category,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reporterName: row.reporter_name,
    lastActivityAt: row.last_activity_at
      ? row.last_activity_at.toISOString()
      : null,
    lastActivityEventType: row.last_activity_event_type,
  };
}

/**
 * 事件的窄投影。**不整段转发 payload**——那是开放 jsonb，运营面往里写过 uuid
 * （assign 的 assignee_id）。只取正文与状态落点两项。
 *
 * 两个键都**双接受**：正文取 `body`（发言/正式回复）或 `note`（状态变更时那句
 * 说明，运营关闭单时的 reason 走的就是它）；状态落点取 `to`（运营面与本文件
 * 写的都是这个键）或 `status`。少认一个键的后果是那句话在页面上凭空消失，
 * 而页面照常渲染——没有任何症状。
 */
function mapEvent(row: TicketEventRow): ConsoleTicketEvent {
  const payload = row.payload ?? {};
  return {
    eventType: row.event_type,
    actorType: row.actor_type,
    actorName: row.actor_name,
    body: textOf(payload["body"]) ?? textOf(payload["note"]),
    status: textOf(payload["to"]) ?? textOf(payload["status"]),
    createdAt: row.created_at.toISOString(),
  };
}
