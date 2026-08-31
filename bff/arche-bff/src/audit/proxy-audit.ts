/**
 * proxy-audit.ts — 代理写操作的控制台级审计（M-5 第二条）。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * `product_250` M-5 有**两条**审计义务，此前 opera 只做到了第一条的对面：
 *   1. provider 域内审计表记录传入的 operator `sub`——这是 **provider 的**义务
 *      （atlas 的 `key.key_rotation_logs` 等，人家做了）；
 *   2. **控制台外壳级操作审计落 platform 审计域**——这是 **opera 的**义务，
 *      2026-08-13 之前**完全没做**：`insertOperatorAuditLog` 全仓只有
 *      `maintenance-windows.router.ts` 在用，`atlas.router.ts` /
 *      `runos.router.ts` 的每一个写路由都是零审计。实际后果是——通过 opera 建
 *      provider、删模型、轮换密钥，**平台侧一条记录都查不到**，Security/Audit
 *      页只有维护窗口。这是合规缺口，不是风格问题。
 *
 * 与 `audit-log.ts` 的关键差别：**这里没有本地事务**。
 * 本地写（维护窗口）能把审计行和业务行放进同一个事务，同生共死；代理写不能——
 * 远端（atlas/runos）已经提交完了，opera 才拿到响应。所以这里是**事后尽力**：
 *
 *   - 审计写失败 **绝不** 反过来让接口报错。远端已经改了，这时候对前端报失败
 *     会诱导操作者重试，等于把一次配置变更做成两次。
 *   - 但失败必须 **落 error 日志**。静默吞掉审计正是 M-5 要防的事——宁可留下
 *     "审计写失败"的运维噪音，也不能留下"什么都没发生"的假象。
 *   - 只在**远端成功后**调用。失败的尝试不写 success 审计；需要留痕的失败尝试
 *     由调用方显式传 `result: "failure"`。
 */
import { Logger } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "./audit-log";
import type { OperatorAuditEntry } from "./audit-log";
import type { RequestContext } from "../types/request-context";

const logger = new Logger("ProxyAudit");

/**
 * 记录一次已经在上游成功的代理写操作。**永不抛错**。
 *
 * @param pool 读写池（审计是写操作，不能走只读池）
 */
export async function recordProxyWrite(
  pool: Pool,
  req: Request & RequestContext,
  entry: OperatorAuditEntry,
): Promise<void> {
  try {
    await insertOperatorAuditLog(pool, req, entry);
  } catch (error) {
    // 见文件头：不改变接口结果，但必须留痕到运维日志。
    logger.error(
      `审计写入失败（操作已在上游生效，不回滚）: ${entry.action} ${entry.resourceType}/${entry.resourceId} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
