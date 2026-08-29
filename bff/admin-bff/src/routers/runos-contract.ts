/**
 * runos-contract.ts — Runos 两条读端点的必有字段与载荷形状（admin 侧）。
 * @package @vxture/bff-admin
 * @layer BFF
 *
 * 机制在 `@vxture-platform/shared`，这里只有**词表**——「我方读哪些字段」是本仓的事实，
 * 「怎么查」不是。规矩与 `atlas-contract.ts` 完全相同；清单比 opera 那份短得多，
 * 因为 admin 对 Runos **只读两条**（目录列表 + 单条详情），凭证 / 审计 / 授权 /
 * 用量那些读流都归 opera，admin 不代理、也就不在这里假装守。
 *
 * 两个 `*-bff` 之间不建依赖仍是本仓明确纪律：它们共用的是 shared，不是彼此。
 * opera-bff 的 `runos-contract.ts` 是独立的一份，这里不 import 它任何东西。
 *
 * ## 为什么读两条也要守
 *
 * 这一页此前是个空桩（`skills.router.ts` 返回字面量 `[]`），从来没有对着上游说过话。
 * 第一次接上游，最容易犯的就是 atlas 那边 2026-08-23 复核抓到的病：类型只是注解，
 * 代理只做断言不做校验，上游改了形状页面读到 `undefined` 继续渲染——不报错。
 * Runos 恰恰是改名最勤的那个上游（`status`→`state`、`droppedAlias`→`droppedAliases`、
 * `latencyMs` 从来不存在），所以哪怕只读两条，也要让漂移**在入口响一声**。
 *
 * 清单逐字段照 `vxture-runos` 的 prisma schema（`registry.capability` /
 * `capability_version` / `capability_alias` / `endpoint_instance`）与
 * `registry.controller.ts` 的 `list` / `get` 两条路由——2026-08-30 对着
 * `D:\MyWebSite\vxturestudio\vxture-runos` 源码核过，不是照 design 文档推测。
 *
 * ## 只查读，不查写响应
 *
 * admin 对 Runos 没有写路由（owner 2026-08-30 裁定：管理留在 opera「能力注册」），
 * 所以这一条在这里是自动成立的——记下来是为了将来有人想加写路由时先读到它。
 */

import { BadGatewayException } from "@nestjs/common";
import {
  makeContractAssert,
  type ContractTable,
} from "@vxture-platform/shared";

export const RUNOS_CONTRACT = {
  /** `GET /capability/capabilities`——裸数组，行是 `registry.capability` 一整行。 */
  capabilities: {
    shape: { kind: "list" },
    fields: [
      "capabilityId",
      "primitiveType",
      "providerId",
      "ownerRef",
      "title",
      /* 准入档：目录页按它分「实验 / 已认证 / 官方」三档着色，缺了整列变灰。 */
      "admissionTier",
      /* v0.5.0 起注册必填（15 选 1）。目录页按它筛选。 */
      "category",
    ],
  },
  /**
   * `GET /capability/capabilities/:id`——单条，比列表多三组关联。
   *
   * `versions[]` 带 `embedding` 向量（上游 include 全量），这一层**不裁剪**：裁了
   * 就等于我们决定哪些字段不重要，而那是上游的载荷问题、该在上游修。
   */
  "capability-detail": {
    shape: { kind: "single" },
    fields: ["capabilityId", "versions", "aliases", "endpoints"],
  },
} as const satisfies ContractTable;

export type RunosResource = keyof typeof RUNOS_CONTRACT;

export const assertRunosContract = makeContractAssert(
  "Runos",
  "RUNOS",
  RUNOS_CONTRACT,
  /* 机制不认识 HTTP：错误封套由本仓注入。本仓直抛 Nest 异常（同 `atlas-contract.ts`），
     opera-bff 用它自己的 `ApiError` 类——机制不替任何一方选，那正是它能被两边共用的原因。 */
  (v) =>
    new BadGatewayException({
      code: v.code,
      message: v.message,
      retryable: false,
      ...(v.field ? { field: v.field } : {}),
    }),
);
