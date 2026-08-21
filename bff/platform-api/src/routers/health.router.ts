/**
 * health.router.ts - 健康检查路由
 * @package @vxture/bff-platform-api
 *
 * @description GET /healthz 存活探针（standards 020 + 025）。零依赖，返回统一
 *              身份块（service/version/gitSha/stage/buildTime/time）。取代此前
 *              硬编码的 version:"1.0.0"——版本经构建期注入或诚实兜底 dev。
 */

import { Controller, Get } from "@nestjs/common";
import { buildHealthIdentity } from "@vxture-platform/shared";

@Controller()
export class HealthRouter {
  @Get("healthz")
  healthz() {
    return buildHealthIdentity({ service: "platform-api", product: "vxture" });
  }
}
