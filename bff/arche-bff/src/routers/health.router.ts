/**
 * health.router.ts - 健康检查路由
 * @package @vxture/bff-opera
 *
 * @description GET /healthz 存活探针（standards 020 + 025）。零依赖，返回统一
 *              身份块（service/version/gitSha/stage/buildTime/time）。
 *
 * @layer Application
 * @category Router
 */

import { Controller, Get } from "@nestjs/common";
import { buildHealthIdentity } from "@vxture-platform/shared";

@Controller()
export class HealthRouter {
  /** GET /healthz — liveness + identity（Docker HEALTHCHECK 消费）。 */
  @Get("healthz")
  check() {
    return buildHealthIdentity({
      service: "arche-bff",
      product: "vxture",
    });
  }
}
