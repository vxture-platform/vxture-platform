/**
 * Bounded lifecycle retries owned by the independent identity process.
 * @package @vxture/bff-auth
 * @layer Application
 * @category job
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
// ⚠️ 跨层引用: The account domain persists and schedules pending lifecycle work.
import { AccountLifecycleRepository } from "@vxture/service-account";
import { CustomerLifecycleService } from "../oidc/customer-lifecycle.service";

@Injectable()
export class CustomerLifecycleJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CustomerLifecycleJob.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(
    @Inject(AccountLifecycleRepository)
    private readonly lifecycle: AccountLifecycleRepository,
    @Inject(CustomerLifecycleService)
    private readonly service: CustomerLifecycleService,
  ) {}
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.pass().catch(() =>
        this.logger.error("lifecycle retry scan failed"),
      );
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  /**
   * Retry a bounded batch without overlapping passes in this process.
   * @returns Completed operations.
   * @throws {Error} On a failed scan; individual adapter failures are recorded and retried.
   */
  async pass(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let completed = 0;
    try {
      for (const id of await this.lifecycle.listPending()) {
        try {
          if (await this.service.process(id)) completed++;
        } catch {
          this.logger.warn(`lifecycle cleanup pending: ${id}`);
        }
      }
      return completed;
    } finally {
      this.running = false;
    }
  }
}
