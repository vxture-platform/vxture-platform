/**
 * health.router.ts - 健康检查路由
 * @package @vxture/bff-admin
 *
 * @description GET /healthz 存活探针（standards 020 + 025）。零依赖，不挂任何
 *              middleware（auth / tenant / permission 均绑在 api/* 路径下），
 *              返回统一身份块（service/version/gitSha/stage/buildTime/time）。
 *
 * @layer Application
 * @category Router
 * @copyright Vxture Team
 */

import { Controller, Get } from "@nestjs/common";
import { buildHealthIdentity } from "@vxture-platform/shared";

@Controller()
export class HealthRouter {
  /**
   * GET /healthz — liveness + identity.
   * 供 Docker HEALTHCHECK / K8s liveness probe / 监控与版本聚合使用。
   */
  @Get("healthz")
  check() {
    return buildHealthIdentity({ service: "admin-bff", product: "vxture" });
  }
}
