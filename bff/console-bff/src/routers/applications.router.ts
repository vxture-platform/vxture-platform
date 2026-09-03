import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";
import { SelfScope } from "../auth/capability";

interface PgPool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string): Promise<{ rows: T[] }>;
}

export interface ApplicationRecord {
  id: string;
  appCode: string;
  appName: string;
  appNameZh: string | null;
  appType: string;
  sort: number;
}

interface ApplicationRow {
  id: string;
  app_code: string;
  app_name: string;
  app_name_zh: string | null;
  app_type: string;
  sort: number;
}

@SelfScope()
@Controller("api/applications")
export class ApplicationsRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: PgPool) {}

  @Get()
  async listApplications(
    @Req() req: Request & RequestContext,
  ): Promise<ApplicationRecord[]> {
    if (!req.user) throw new UnauthorizedException("No active session");

    // The old application table merged into product.products; the retired i18n
    // table is replaced by dual-name columns product_name (primary) / product_nick.
    const res = await this.pool.query<ApplicationRow>(
      `SELECT p.id,
              p.product_code AS app_code,
              COALESCE(p.product_name, p.product_code) AS app_name,
              p.product_nick AS app_name_zh,
              p.product_type AS app_type,
              p.sort
       FROM product.products p
       WHERE p.status = 'active'
         AND p.deleted_at IS NULL
       ORDER BY p.sort ASC, p.product_code ASC`,
    );

    return res.rows.map((r) => ({
      id: r.id,
      appCode: r.app_code,
      appName: r.app_name,
      appNameZh: r.app_name_zh,
      appType: r.app_type,
      sort: r.sort,
    }));
  }
}
