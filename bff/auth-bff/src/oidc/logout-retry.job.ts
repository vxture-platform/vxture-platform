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
  private monitorTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private monitoring = false;

  constructor(@Inject(OidcService) private readonly oidc: OidcService) {}

  onApplicationBootstrap(): void {
    void this.pass();
    this.timer = setInterval(() => void this.pass(), 1000);
    this.timer.unref();
    void this.monitor();
    this.monitorTimer = setInterval(() => void this.monitor(), 60_000);
    this.monitorTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.monitorTimer) clearInterval(this.monitorTimer);
  }

  /** Monitor independently so a slow telemetry read never delays delivery retries. */
  async monitor(): Promise<void> {
    if (this.monitoring) return;
    this.monitoring = true;
    try {
      await this.oidc.reportLogoutBacklog();
    } catch {
      this.logger.error({ event: "oidc_logout_backlog_monitor_failed" });
    } finally {
      this.monitoring = false;
    }
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
