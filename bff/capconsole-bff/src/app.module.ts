import { Module } from "@nestjs/common";
import { OidcRpModule } from "./oidc/oidc-rp.module";
import { HealthRouter } from "./routers/health.router";

@Module({
  imports: [OidcRpModule],
  controllers: [HealthRouter],
})
export class AppModule {}
