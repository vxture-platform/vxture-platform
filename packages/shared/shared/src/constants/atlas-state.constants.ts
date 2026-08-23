/**
 * atlas-state.constants.ts — Atlas 对象状态的词表，以及**读它的两个问题**。
 * @package @vxture-platform/shared
 *
 * 权威在 vxture-atlas `service/src/object-state.ts`（product_251 M-B3）。本文件是它在
 * 消费侧的镜像：**两个门户（opera / admin）都读同一批记录**，词表与判断只能有一份。
 *
 * ## 为什么这次连谓词也放进来
 *
 * `catalog-domains.constants.ts` 立了一条规矩：**纯值集 + 类型，零业务逻辑**——哪个状态
 * 算有覆盖、层级怎么排，归拥有那个域的服务。这条规矩在这里**不适用**，差别是实打实的：
 *
 * - 「哪个订阅状态算有覆盖」是**平台自己的商业政策**，可以改，改了不影响别人；
 * - 「`deprecated` 算不算还在服务」是**上游契约的事实**——atlas 自己定的优先级
 *   `deleted_at` > `is_active` > `deprecated_at`，`deprecated` 那一行的 `is_active`
 *   就是 true。两个门户对同一个字段得出不同结论，其中必有一个是错的。
 *
 * 所以放在这里的不是一条政策，是**上游契约的一次翻译**。政策仍归各自的域。
 *
 * ## 为什么不是一个布尔
 *
 * 2026-08-23 之前 opera-bff 有个垫片把 `state` 反推成 `isActive` 布尔给门户读。它必然失真：
 * 模型是三值的，`deprecated` **仍可解析、只是不再推荐**。清理它时的判据是——迁移不是把
 * `isActive` 换成一个表达式，而是换成**一个说清自己在问什么的名字**。所以这里给的是两个
 * 具名谓词，不是一个 `isActive(state)`。
 *
 * | 场景 | 用哪个 | 因为 |
 * | --- | --- | --- |
 * | 它现在还能不能承接调用 | `isServing` | `deprecated` 能 |
 * | 运营把它设成什么了（启停开关、状态徽标） | `isEnabled` | `deprecated` 要单独成档，不能读成「已停用」 |
 * | 下拉里该不该给人选 | `isServing` | 选一个仍可解析的弃用模型是合法决定 |
 * | 统计「有多少在跑」 | `isServing` | 少算弃用的会低报真实服务面 |
 *
 * 两值资源（Provider / Endpoint / Grant / Provider Key / 价格规则 / 策略）没有第三档，
 * 两个谓词结果恒等——对它们用 `isEnabled`，那才是那些页面在问的问题。
 */

/** 两值资源的最小词表。 */
export const OBJECT_STATES = ["active", "inactive"] as const;
export type ObjectState = (typeof OBJECT_STATES)[number];

/**
 * 模型的三值状态。第三档正是 M-B3 立论那句话的实例：**仍可解析、不再推荐**，
 * 既不是 true 也不是 false，布尔装不下。
 */
export const MODEL_STATES = ["active", "inactive", "deprecated"] as const;
export type ModelState = (typeof MODEL_STATES)[number];

/**
 * 网关 API Key 的状态。`revoked` 是**真正的终态**——不是关掉，是再也回不来，
 * 所以它不能和 `inactive` 并成一档。
 */
export const KEY_STATES = ["active", "inactive", "revoked"] as const;
export type KeyState = (typeof KEY_STATES)[number];

/**
 * 运营**把它设成开着**了吗。
 *
 * 用在启停开关、状态徽标、「已停用」筛选这类**反映运营意图**的地方。对模型而言
 * `deprecated` 在这里是 false——但那不代表它该显示成「已停用」，它该单独显示成
 * 「已弃用」。**别拿这个函数去给三值对象渲染二元徽标。**
 */
export function isEnabled(state: string | undefined): boolean {
  return state === "active";
}

/**
 * 它现在**还能不能承接调用**。
 *
 * `deprecated` 算能：它仍可解析，只是不再推荐——这正是它与 `inactive` 的全部区别。
 * 用在容量统计、可选项过滤、依赖计数这类**反映真实服务面**的地方。
 */
export function isServing(state: string | undefined): boolean {
  return state === "active" || state === "deprecated";
}

/**
 * 一条带生效窗口的记录**此刻是否在生效**。
 *
 * Atlas 的配额（`/capability/quotas`）**没有 `state` 也没有 `isActive`**——它的"生不生效"
 * 完全由 `effectiveAt` / `expiresAt` 这个窗口决定，是**读时判定**的（与 product grant、
 * 网关 key 的到期同一套：没有定时清扫任务，因为定时改写会改掉它本该保全的记录）。
 *
 * 所以对配额问「有多少条生效中」时，唯一诚实的答法是算这个窗口，而不是去读一个上游从来
 * 没有过的布尔。
 */
export function isInForce(
  window: { effectiveAt?: string | null; expiresAt?: string | null },
  now: number = Date.now(),
): boolean {
  const startsAt = window.effectiveAt
    ? new Date(window.effectiveAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const endsAt = window.expiresAt
    ? new Date(window.expiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  return startsAt <= now && now < endsAt;
}
