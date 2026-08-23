/**
 * upstream-contract.ts — 上游响应契约断言的**机制**（词表在各消费方自己的仓内）。
 * @package @vxture-platform/shared
 * @layer shared
 *
 * ## 这一层解决的是什么
 *
 * 2026-08-23 的复核里，17 条缺陷有 8 条是同一个形状：**我方声明的字段名与上游真实返回的
 * 不一致，而代理层的 `request<T>()` 只做类型断言、不做运行时校验**——于是 TypeScript 一条
 * 都拦不住，页面读到 `undefined`，把「生效中」渲染成「停用」、把计数渲染成 0，全程不报错。
 *
 * 断言就是让这类漂移**在入口响一声**：必有字段缺了 → 502 + 点名哪个资源缺哪个字段。
 *
 * ## 为什么形状要**声明**，不能**嗅探**
 *
 * 上游的读有三种载荷形状：裸数组、分页信封、单个对象。第一版实现是**嗅**——看见有某个
 * 键就当信封。它能跑，但有一个致命性质：
 *
 * > **嗅探会静默适应上游的形状变化。**
 *
 * 上游哪天把分页信封换成裸数组（或反过来），嗅探会顺从地继续检查、一声不吭——而"悄悄
 * 适应上游变化"正是这整套断言要消灭的东西。守卫自己带着它要防的病，是最难发现的一种。
 *
 * 所以形状写进资源表，由**这一层去核对**：声明 `page` 却收到数组 = 契约违约，报
 * `*_CONTRACT_SHAPE_CHANGED`。这比"能继续跑"强，因为分页信封消失意味着 `nextCursor`
 * 没了——页面会安静地只显示第一页，且永远不知道还有更多。
 *
 * ## 为什么住在 shared，而不是某个 BFF 里
 *
 * 2026-08-24：opera-bff 与 admin-bff 各有一份，且**两份已经漂了**——admin 那份只认裸数组，
 * 于是它的信封读一条都没被守住。同一个仓里两套契约守卫，正是 `product_251` A-4 刚在上游
 * 消灭的那个病，低一层的版本。
 *
 * 本文件**零框架依赖**（符合本包"运行于任何环境"的定位）：异常类型由调用方通过
 * `violation` 注入——两个 BFF 的错误封套本来就不同（一个有 `ApiError` 类，一个直抛
 * `BadGatewayException`），机制不该替它们选。
 *
 * ## 检查什么、不检查什么（三条，所有上游共用）
 *
 * - 只查**必有且消费方真的读**的字段，不做全量 schema 校验：全量校验要在这里维护一份
 *   上游 schema 的副本，那是第二个会漂的事实来源。
 * - 只查"少"不查"多"：上游加字段是兼容变更，永远不是错。
 * - **只挂读，不挂写响应**：一次误判会挡掉一个**已经在上游生效了**的写，那比漏检更坏。
 */

/**
 * 一个读端点的载荷形状。**按端点声明，不按运行时猜。**
 *
 * `rowsKey` 曾经两个上游各说各话（atlas `items` / runos `rows`），`product_251` A-4
 * 已经把它收敛掉了。参数留着是因为形状仍需声明，不是因为分歧仍需吸收。
 */
export type PayloadShape =
  | { readonly kind: "list" }
  | {
      readonly kind: "page";
      readonly rowsKey: string;
      /**
       * 信封**自己**必有的键——不是行上的。
       *
       * A-4 之后这一项是必需的，不是可选的讲究：信封存在的**唯一理由**就是装服务端
       * 解析出来的东西（游标、默认窗口、默认聚合轴）。只查行不查信封，等于放过了
       * 信封唯一有价值的那部分。
       *
       * 而且它修一个已经发生过的漏检：`nextCursor` 此前从来没被守过，于是
       * 「runos 早就交付了游标、opera 一次都没消费」这件事在守卫全绿的情况下存在了很久。
       */
      readonly envelopeFields?: readonly string[];
    }
  | { readonly kind: "single" };

export interface ResourceContract {
  /** 必有字段。每一条进来都要能说出「消费方哪里读它」。 */
  readonly fields: readonly string[];
  readonly shape: PayloadShape;
}

export interface ContractTable {
  readonly [resource: string]: ResourceContract;
}

/** 一次契约违约的描述。转成什么 HTTP 异常由调用方决定。 */
export interface ContractViolation {
  readonly code: string;
  readonly message: string;
  /** 字段级违约时点名第一个缺的，便于前端定位。 */
  readonly field?: string;
}

/** 把违约描述变成一个可抛的错误。两个 BFF 的错误封套不同，所以由它们各自提供。 */
export type ViolationFactory = (violation: ContractViolation) => Error;

/**
 * 造一个断言函数。
 *
 * @param upstream   只进错误消息（`"Atlas"` / `"Runos"`）。
 * @param codePrefix 错误码前缀（`"ATLAS"` / `"RUNOS"`）——两个上游的故障要能分开检索。
 * @param table      资源表：每条读声明自己的形状与必有字段。
 * @param violation  把违约变成异常。见本文件头「为什么住在 shared」。
 */
export function makeContractAssert<T extends ContractTable>(
  upstream: string,
  codePrefix: string,
  table: T,
  violation: ViolationFactory,
) {
  return function assertContract<P>(payload: P, resource: keyof T & string): P {
    const contract = table[resource];
    /* 表里没有这条 = 调用点写错了资源名。不静默放行：一个查不到表的守卫就是没有守卫。 */
    if (!contract) {
      throw violation({
        code: `${codePrefix}_CONTRACT_UNKNOWN_RESOURCE`,
        message:
          `${upstream} 契约表里没有 "${resource}" 这条。调用点的资源名写错了，` +
          `或者新增读的时候忘了往表里加——两种都要修，不能当成"没配就不查"。`,
      });
    }

    const shape = contract.shape;
    const report = (missing: string[], where: string): never => {
      const first = missing[0];
      throw violation({
        code: `${codePrefix}_CONTRACT_FIELD_MISSING`,
        message:
          `${upstream} 的 ${resource} ${where}缺少契约要求的字段：${missing.join("、")}。` +
          `这台 ${upstream} 早于交付这些字段的版本，或者上游改了形状。` +
          `消费方不对缺失字段做降级显示——降级会把一个坏掉的契约渲染成正常界面。`,
        /* 条件展开而不是 `field: missing[0]`：本仓开了 `exactOptionalPropertyTypes`，
           显式的 `undefined` 与「这个键不存在」不是一回事。 */
        ...(first ? { field: first } : {}),
      });
    };

    const row = firstRow(
      payload,
      shape,
      upstream,
      codePrefix,
      resource,
      violation,
    );

    /* 信封先查。**这一步不受空集合影响**——这正是它的价值：`nextCursor` 或
       `dimension` 没了，在一条数据都没有的时候同样要报，而那恰恰是行检查失明的时刻。 */
    if (shape.kind === "page" && shape.envelopeFields) {
      const envelope = payload as Record<string, unknown>;
      const missing = shape.envelopeFields.filter(
        (field) => envelope[field] === undefined,
      );
      if (missing.length > 0) report(missing, "响应信封上");
    }

    /* null = 没有行可查（空集合）。「这个资源一条都没有」是合法结果，不是契约问题。 */
    if (row === null) return payload;

    const missing = contract.fields.filter(
      (field) => (row as Record<string, unknown>)[field] === undefined,
    );
    if (missing.length === 0) return payload;

    /* `report` 返回 never；写成 return 是为了让控制流分析看见这条路径终止。 */
    return report(missing, shape.kind === "page" ? "的行上" : "响应里");
  };
}

/**
 * 按**声明的**形状取出待校验的那一行；形状对不上就抛。
 *
 * 返回 `null` 表示没有行可查（空集合）。注意这与"形状不对"是两回事，后者会抛——
 * 把两者混成一个 `null` 正是嗅探版本的问题所在。
 */
function firstRow(
  payload: unknown,
  shape: PayloadShape,
  upstream: string,
  codePrefix: string,
  resource: string,
  violation: ViolationFactory,
): unknown | null {
  const shapeChanged = (expected: string, got: string): never => {
    throw violation({
      code: `${codePrefix}_CONTRACT_SHAPE_CHANGED`,
      message:
        `${upstream} 的 ${resource} 响应形状变了：契约声明是 ${expected}，实际收到 ${got}。` +
        `**不按新形状继续解析**——形状变了通常意味着有东西没了（分页信封消失就是 ` +
        `nextCursor 没了，页面会安静地只显示第一页，且永远不知道还有更多）。`,
    });
  };

  switch (shape.kind) {
    case "list":
      if (!Array.isArray(payload)) {
        return shapeChanged("裸数组", describe(payload));
      }
      return payload.length > 0 ? payload[0] : null;

    case "page": {
      if (
        Array.isArray(payload) ||
        payload === null ||
        typeof payload !== "object"
      ) {
        return shapeChanged(
          `分页信封（{${shape.rowsKey}: [...]}）`,
          describe(payload),
        );
      }
      const rows = (payload as Record<string, unknown>)[shape.rowsKey];
      if (!Array.isArray(rows)) {
        return shapeChanged(
          `分页信封（{${shape.rowsKey}: [...]}）`,
          `一个没有 ${shape.rowsKey} 数组的对象`,
        );
      }
      return rows.length > 0 ? rows[0] : null;
    }

    case "single":
      if (Array.isArray(payload)) return shapeChanged("单个对象", "数组");
      if (payload === null || typeof payload !== "object") {
        /* 空响应体（204 之类）没有形状可查，放行——它不是"形状变了"。 */
        return null;
      }
      return payload;
  }
}

function describe(payload: unknown): string {
  if (Array.isArray(payload)) return "数组";
  if (payload === null) return "null";
  return typeof payload === "object" ? "对象" : typeof payload;
}
