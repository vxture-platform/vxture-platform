/**
 * authn.module.ts — registration + login + central session (Task 4.3).
 * Wires service-account (credentials), service-organization (org + active context),
 * service-sms (phone code), the TokenModule (4.2) and SessionService.
 */
import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { AccountModule } from "@vxture/service-account";
import { OrganizationModule } from "@vxture/service-organization";
import { MailModule } from "@vxture/service-mail";
import { SmsModule } from "@vxture/service-sms";
import { Pool } from "pg";
import { TokenModule } from "../token/token.module";
import { CustomerPhoneCodeService } from "./customer-phone-code.service";
import { AuthnService } from "./authn.service";
import { UserOnboardingService } from "./user-onboarding.service";
import { PasswordResetRepository } from "./password-reset.repository";
import { SessionService } from "./session.service";
import { SESSION_PG_POOL } from "./tokens";

@Module({
  imports: [
    VxConfigModule.register({ domains: ["database", "auth", "platform"] }),
    AccountModule,
    OrganizationModule,
    MailModule,
    SmsModule,
    TokenModule,
  ],
  providers: [
    {
      provide: SESSION_PG_POOL,
      inject: [VxConfigService],
      useFactory: (config: VxConfigService) => {
        const database = config.database;
        return new Pool(
          database.DATABASE_URL
            ? { connectionString: database.DATABASE_URL }
            : {
                host: database.DB_HOST,
                port: database.DB_PORT,
                database: database.DB_NAME,
                user: database.DB_USER,
                password: database.DB_PASSWORD,
                max: database.DB_POOL_MAX,
                ssl:
                  database.DB_SSL === "require"
                    ? { rejectUnauthorized: false }
                    : undefined,
              },
        );
      },
    },
    SessionService,
    PasswordResetRepository,
    UserOnboardingService,
    AuthnService,
    CustomerPhoneCodeService,
  ],
  exports: [
    CustomerPhoneCodeService,
    AuthnService,
    SessionService,
    UserOnboardingService,
  ],
})
export class AuthnModule {}
