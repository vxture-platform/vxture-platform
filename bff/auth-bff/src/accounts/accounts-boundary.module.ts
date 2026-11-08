/**
 * Reusable account-center boundary without portal or tenant context.
 * @package @vxture/bff-auth
 * @layer Application
 * @category module
 * @author AI-Generated
 * @date 2026-11-07
 */
import { Module } from "@nestjs/common";
// ⚠️ 跨层引用: Resolve realm identities through their separate public domain modules.
import { AccountModule } from "@vxture/service-account";
// ⚠️ 跨层引用: Workforce identities remain in the IAM domain.
import { IamModule } from "@vxture/service-iam";
import { AuthnModule } from "../authn/authn.module";
import { RedisModule } from "../redis/redis.module";
import { RealmSessionService } from "../oidc/realm-session.service";
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { AccountsOriginGuard } from "./accounts-origin.guard";

@Module({
  imports: [AuthnModule, AccountModule, IamModule, RedisModule],
  providers: [
    AccountsOriginGuard,
    RealmSessionService,
    CustomerSelfGuard,
    OperatorSelfGuard,
  ],
  exports: [
    AccountsOriginGuard,
    RealmSessionService,
    CustomerSelfGuard,
    OperatorSelfGuard,
  ],
})
export class AccountsBoundaryModule {}
