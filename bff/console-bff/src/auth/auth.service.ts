import { Inject, Injectable } from "@nestjs/common";
import { AccountService } from "@vxture/service-account";
import type { ConsoleUser } from "../types/console.types";

/**
 * Console Auth Service (Identity Platform).
 *
 * Token issuance + verification live in the IdP (auth-bff, RS256). This service
 * resolves the current user from @vxture/service-account (the new identity-core
 * users), used by the OIDC-RP auth middleware. The legacy HS256 verify is retired.
 */
@Injectable()
export class ConsoleAuthService {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  async getCurrentUser(userId: string): Promise<ConsoleUser | null> {
    const user = await this.account.getUserById(userId);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      name: user.name ?? user.account,
      email: user.email ?? `${user.account}@local.vxture`,
      roleLabel: "Authenticated User",
      username: user.account,
      phone: user.phone,
      // 保留期(deleting)的用户仍能解析出来;auth.middleware 据此把非删除相关的
      // 路由挡成 403,console 则提示「撤销删除并重新启用」(050-account §7)。
      accountStatus: user.status,
      deletionRequestedAt: user.deletionRequestedAt ?? null,
    };
  }
}
