/**
 * Resume persisted central logout work after delivery failures or process restarts.
 * @package @vxture/bff-auth
 * @layer Application
 * @category job
 * @author AI-Generated
 * @date 2026-11-17
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { OidcService } from "./oidc.service";

@Injectable()
export class LogoutRetryJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LogoutRetryJob.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(@Inject(OidcService) private readonly oidc: OidcService) {}

  onApplicationBootstrap(): void {
    void this.pass();
    this.timer = setInterval(() => void this.pass(), 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Prevent overlapping local passes; Redis leases coordinate independent replicas. */
  async pass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.oidc.retryPendingLogouts();
    } catch {
      this.logger.error("Central logout retry scan failed");
    } finally {
      this.running = false;
    }
  }
}
