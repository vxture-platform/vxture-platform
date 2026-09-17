/**
 * platform-provisioning.service.ts — 开通回执的编排层。
 * @package @vxture/bff-platform-api
 *
 * 与 `platform-usage.service.ts` 同形:解析 `product_code → id`，其余转发给
 * commerce 侧的单一写者（`ProvisioningService`）。这一层不判断回执该不该被接受——
 * 那是路由层 S2S 归因的事;也不决定怎么落库——那在仓库层。
 *
 * 单独成一个 service 而不是挂到 `PlatformUsageService` 上:回执与用量是两件事，
 * 借用后者只会让「用量服务里为什么有个开通方法」变成下一个人要问的问题。等 Phase 2
 * 把 `provisioned` 的写入时机切到回执时，状态机那一段也落在这里。
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import {
  ProvisioningService,
  type ProvisioningAckInput,
  type ProvisioningAckResult,
} from "@vxture/service-provisioning";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

@Injectable()
export class PlatformProvisioningService {
  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(ProvisioningService)
    private readonly provisioning: ProvisioningService,
  ) {}

  /** product_code → id;不在目录里（或已软删）时回 null。与 usage 那条同一份写法。 */
  async resolveProductId(productCode: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM product.products WHERE product_code = $1 AND deleted_at IS NULL`,
      [productCode],
    );
    return res.rows[0]?.id ?? null;
  }

  async recordAck(
    input: ProvisioningAckInput,
  ): Promise<ProvisioningAckResult | null> {
    return this.provisioning.recordAck(input);
  }
}
