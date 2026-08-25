/**
 * atlas-contract.ts — Atlas 各读端点的必有字段与载荷形状（admin 侧）。
 * @package @vxture/bff-admin
 * @layer BFF
 *
 * 机制在 `@vxture-platform/shared`，这里只有**词表**——「我方读哪些字段」是本仓的事实，
 * 「怎么查」不是。清单与 opera 那份不同（admin 管商业封装：grants / price-rules /
 * policies / quotas / usage-summaries；opera 管技术供给），规矩相同。
 *
 * 两个 `*-bff` 之间不建依赖仍是本仓明确纪律：它们共用的是 shared，不是彼此。
 *
 * ## 为什么加它
 *
 * 2026-08-23 复核发现 admin 这侧的 atlas 类型漂得比 opera 还远：
 *
 * - 六个记录里**每一个**都还声明着 `isActive`，而 atlas 早已改发 `state`；
 * - `ModelPolicyRecord` 与 `TenantQuotaRecord` **整个形状**都是上游不再返回的旧版
 *   （`policyCode`/`dailyTokenLimit`/`periodStart`/`maxAgents`… 一个都不存在）；
 * - 三条更新路由发的是 PUT，而 atlas 只注册了 PATCH——**实测 404**。
 *
 * 前两类的共同点是**不报错**：类型只是注解，`atlasRequest<T>()` 只做断言不做校验，
 * 于是页面读到一堆 `undefined`，把「生效中」渲染成「停用」、把计数渲染成 0。
 * 这道断言就是让这类漂移**在入口处响一声**，而不是在界面上安静地错着。
 *
 * ## 2026-08-24：机制换成共用的，并补上被跳过的那条读
 *
 * 这份文件此前自带一份**只认裸数组**的实现。代价是具体的：`usage-summaries` 是信封，
 * 于是它**一条都没被守住**，而恰恰是它的类型整体陈旧（`id` / `statType` /
 * `totalRequests` … 上游一个都不发）。
 *
 * 同一个仓里两套契约守卫，正是 `product_251` A-4 刚在上游消灭的那个病，低一层的版本：
 * **两份实现都自洽，代价落在同时对着两边的人身上**——这里那个人就是我们自己。
 *
 * ## 只查读，不查写响应
 *
 * 页面渲染的每一行都来自读；而挂在写响应上，一次误判会挡掉一个**已经在上游生效了**
 * 的写——那比漏检更坏。
 */

import { BadGatewayException } from "@nestjs/common";
import {
  makeContractAssert,
  type ContractTable,
} from "@vxture-platform/shared";

/** 逐字段照 atlas `model-admin.service.ts` 的 `*AdminRecord`。 */
export const ATLAS_CONTRACT = {
  providers: {
    shape: { kind: "list" },
    fields: ["id", "providerCode", "providerName", "providerType", "state"],
  },
  models: {
    shape: { kind: "list" },
    fields: [
      "id",
      "modelCode",
      "modelName",
      "provider",
      "protocol",
      "modelType",
      "state",
    ],
  },
  "tenant-model-grants": {
    shape: { kind: "list" },
    fields: ["id", "modelId", "tenantId", "priority", "state"],
  },
  "price-rules": {
    shape: { kind: "list" },
    fields: [
      "id",
      "modelId",
      "billingMode",
      "currency",
      "unitTokens",
      "inputUnitPrice",
      "outputUnitPrice",
      "requestUnitPrice",
      // atlas v0.3.0 起必发（值可空，键必在）。列进来是有意的：这一列决定成本
      // 差 30 倍，上游哪天不发了，要在入口响一声而不是在报表里安静地错。
      "cachedInputUnitPrice",
      "state",
      "effectiveAt",
    ],
  },
  policies: {
    shape: { kind: "list" },
    fields: [
      "id",
      "modelId",
      "priority",
      "state",
      "effectiveAt",
      /* 速率三维。旧类型里的 dailyTokenLimit / monthlyRequestLimit 之类上游一个都不发，
         缺了它们等于这一页在按一套不存在的限流模型说话。 */
      "rateLimitRpm",
      "rateLimitTpm",
      "rateLimitTpd",
    ],
  },
  /* 配额**没有 state**——它生不生效由 effectiveAt/expiresAt 的窗口决定，读时判定。
     所以这里断言的是那个窗口的起点，而不是一个上游从来没有过的状态字段。 */
  quotas: {
    shape: { kind: "list" },
    fields: [
      "id",
      "tenantId",
      "quotaCycle",
      "periodTokens",
      "allowedModels",
      "effectiveAt",
    ],
  },
  /**
   * 用量汇总。**此前完全没被守住**——旧实现只认裸数组，而这条是信封，于是它整条被
   * 静默跳过，跳过还没被记下来。
   *
   * `dimension` 在信封上不在行上（`product_251` A-4）：`groupBy` 服务端默认 `tenant`，
   * 是解析出来的，必须回显；放在行上时空结果会让回显整个消失，拿到 `[]` 的调用方
   * 无从得知自己查的是哪根轴。
   */
  "usage-summaries": {
    shape: {
      kind: "page",
      rowsKey: "items",
      envelopeFields: ["dimension"],
    },
    fields: ["cycleMonth", "requests", "totalTokens", "errors"],
  },
} as const satisfies ContractTable;

export type AtlasResource = keyof typeof ATLAS_CONTRACT;

export const assertAtlasContract = makeContractAssert(
  "Atlas",
  "ATLAS",
  ATLAS_CONTRACT,
  /* 机制不认识 HTTP：错误封套由本仓注入。本仓直抛 Nest 异常，opera-bff 用它自己的
     `ApiError` 类——机制不替任何一方选，那正是它能被两边共用的原因。 */
  (v) =>
    new BadGatewayException({
      code: v.code,
      message: v.message,
      retryable: false,
      ...(v.field ? { field: v.field } : {}),
    }),
);
