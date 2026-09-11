import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";
import { SelfScope } from "../auth/capability";

interface PgPool {
  /* 本地窄接口，避免把 pg 的类型拖进来。`params` 是 2026-09-11 补的——
     图标端点要按 product_code 查，而原来这个签名连参数位都没有。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
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

  /**
   * 产品图标的字节。平台托管（`product.product_icons`），不是产品域名的外链。
   *
   * ── 缓存 ──
   * URL 上带 `?v=<checksum>`，所以同一个 URL 的内容**永不改变**——可以
   * `immutable` 一年。换图会换 checksum、换 URL，缓存自然失效。
   * 这正是外链方案做不到的那一半：外链换图不换 URL，浏览器与 CDN 里还是旧的。
   *
   * 同时给 ETag：没带 `?v=` 的老链接（或手敲的）仍能靠 304 省掉字节。
   *
   * ── 安全头 ──
   * `nosniff` + 精确 `Content-Type`：库上只允许三种位图，但纵深防御——
   * 让浏览器不要去猜一个被伪造成 PNG 的文件到底是什么。
   *
   * ── 不要求登录 ──
   * 图标是产品的公开标识（官网也要用），而且已经按 `status='active'` 过滤。
   * 要求会话反而会让 `<img>` 在未登录页面上裂图。
   */
  @Get(":appCode/icon")
  async getIcon(
    @Param("appCode") appCode: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-none-match") ifNoneMatch?: string,
  ): Promise<StreamableFile | undefined> {
    const found = await this.pool.query<{
      mime_type: string;
      bytes: Buffer;
      checksum: string;
    }>(
      `SELECT i.mime_type, i.bytes, i.checksum
         FROM product.product_icons i
         JOIN product.products p ON p.id = i.product_id
        WHERE p.product_code = $1 AND p.deleted_at IS NULL`,
      [appCode],
    );
    const row = found.rows[0];
    if (!row) {
      /* 没有托管图标不是错误——界面本来就会回落到产品字母牌。回 404 让
         `<img>` 走它的 onError 分支，而不是渲染一个坏掉的图。 */
      throw new NotFoundException("No icon");
    }
    const etag = `"${row.checksum}"`;
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    res.set({
      "Content-Type": row.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(row.bytes);
  }
}
