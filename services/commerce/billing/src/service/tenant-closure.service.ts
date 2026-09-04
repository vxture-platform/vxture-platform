/**
 * tenant-closure.service.ts — 租户清账快照(删除账号资格判定用,050-account §7)。
 * @package @vxture/service-billing
 */

import { Inject, Injectable } from "@nestjs/common";
import { PgTenantClosureRepository } from "../repository/pg-tenant-closure.repository";
import type { TenantClosureSnapshot } from "../types/closure.types";

@Injectable()
export class TenantClosureReadService {
  constructor(
    @Inject(PgTenantClosureRepository)
    private readonly repo: PgTenantClosureRepository,
  ) {}

  getSnapshot(tenantId: string): Promise<TenantClosureSnapshot> {
    return this.repo.getSnapshot(tenantId);
  }
}
