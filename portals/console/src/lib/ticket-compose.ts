/**
 * ticket-compose.ts — 「就这件事求助」这一跳的地址：拼与拆。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * ── owner 2026-09-29 第 5 条裁决：其他页面只做跳转入口 ──
 * 原话是「其他页面的求助只做跳转入口，**不许再出现第二个提单表单**」。所以订单行、
 * 账单行、订阅卡上那几个入口一律只是一条 URL：带着这个对象的**可视码**跳到
 * `/tickets`，由那一页上唯一的那个对话框自己开起来并把标题填好。
 *
 * 判据写在这里而不是各页各拼一次 query：三处拼错一个参数名的后果是「点了没反应」
 * ——对话框不开，而页面本身照常渲染，没有任何报错。拼与拆在同一个文件里，参数名
 * 只有一处定义。
 *
 * ── 为什么带的是可视码，不是 id ──
 * 这条 URL 会**印在地址栏里**，而预填的标题会**印在客户提交的工单标题上**（那行
 * 字之后运营也读、通知正文也可能引到）。uuid 不过河这条铁律在这里有两个落点，
 * 所以 `parseTicketCompose` 不只是解析，它还**拒收** uuid 形状的值：手拼一条
 * `?about=<uuid>` 的链接进来，也不会让那串东西出现在任何一行文字里。
 */

/** 能被"就这件事求助"指着的对象。三处入口，三个值。 */
export const TICKET_SUBJECT_TYPES = ["order", "bill", "subscription"] as const;
export type TicketSubjectType = (typeof TICKET_SUBJECT_TYPES)[number];

/** 工单列表页（唯一有提单表单的地方）。 */
export const TICKETS_PATH = "/tickets";

/* 三个参数名。改这里就改了全部拼与拆的调用点。 */
const COMPOSE_PARAM = "compose";
const SUBJECT_TYPE_PARAM = "aboutType";
const SUBJECT_CODE_PARAM = "about";

/**
 * uuid 的形状。命中即丢弃整个 subject。
 *
 * 不是"顺手加的一道防御"：`about` 的值最终会进标题文字，而标题是展示面。
 * 上游某个页面哪天把 `subscriptionId` 当成 `productCode` 传过来（那两个字段
 * 在同一个对象上紧挨着），静态检查一个字都不会说——这一行是那种情况下唯一
 * 会拦住它的东西。
 */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 可视码的形状：字母 / 数字 / 连字符 / 下划线，4–64 位。
 *
 * 平台的可视码都在这个形状里（`TK-202609-0000000001`、订单号、账单号、产品码）。
 * 不写得更严（比如"必须大写"）是因为产品码本来就是小写的（`karda`、`atlas`），
 * 写严了会把真码挡在外面——而挡在外面的症状同样是"点了没反应"。
 */
const VISIBLE_CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;

export interface TicketSubject {
  readonly type: TicketSubjectType;
  readonly code: string;
}

export interface TicketComposeIntent {
  /** 要不要一进页面就把提单对话框开起来。 */
  readonly compose: boolean;
  /** 这张单是关于什么的；没带、或带的东西不合形状就是 null。 */
  readonly subject: TicketSubject | null;
}

function isSubjectType(value: string | null): value is TicketSubjectType {
  return (
    value !== null &&
    (TICKET_SUBJECT_TYPES as readonly string[]).includes(value)
  );
}

function isVisibleCode(value: string | null): value is string {
  if (value === null) return false;
  if (UUID_SHAPE.test(value)) return false;
  return VISIBLE_CODE_SHAPE.test(value);
}

/**
 * 拼一条"就这件事求助"的地址。
 *
 * 不给 subject 时就是一条"去提单"的地址（顶栏抽屉底部那颗按钮用它）。
 * 给了 subject 但码不合形状时，**只跳不带对象**：宁可让客户自己写一句，
 * 也不把一串不该出现的东西印到标题里。
 */
export function buildTicketComposeHref(subject?: TicketSubject | null): string {
  const query = new URLSearchParams({ [COMPOSE_PARAM]: "1" });
  if (subject && isVisibleCode(subject.code)) {
    query.set(SUBJECT_TYPE_PARAM, subject.type);
    query.set(SUBJECT_CODE_PARAM, subject.code);
  }
  return `${TICKETS_PATH}?${query.toString()}`;
}

/** 一张单的详情地址。参数是**可视码**，路由里不会出现 uuid。 */
export function buildTicketDetailHref(ticketNo: string): string {
  return `${TICKETS_PATH}/${encodeURIComponent(ticketNo)}`;
}

/** 读取的是 `useSearchParams()` 那个形状，测试里喂 `URLSearchParams` 即可。 */
export interface ReadableParams {
  get(name: string): string | null;
}

export function parseTicketCompose(
  params: ReadableParams | null | undefined,
): TicketComposeIntent {
  if (!params) return { compose: false, subject: null };
  const type = params.get(SUBJECT_TYPE_PARAM);
  const code = params.get(SUBJECT_CODE_PARAM);
  const subject: TicketSubject | null =
    isSubjectType(type) && isVisibleCode(code) ? { type, code } : null;
  /* 带了合法对象就当成"要提单"，即使 compose 参数丢了：那条链接只有一个用途。
     反过来，`compose=1` 不带对象也成立——顶栏抽屉的「提交工单」就是这一种。 */
  return {
    compose: params.get(COMPOSE_PARAM) === "1" || subject !== null,
    subject,
  };
}
