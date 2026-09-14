/**
 * operator-anomaly.service.ts — operator login anomaly detection + alerting.
 * @package @vxture/bff-auth
 *
 * Operator-identity-security.md §5: surface anomalous operator logins
 * (new location / new device) and failed-attempt spikes. Detection reads
 * admin.operator_login_attempt; on a hit it writes a high-risk support.audit_log
 * event (actor_type=operator) and emails the affected operator. Best-effort by
 * design — a detection/alert failure must never break or block a login.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  detectLoginAnomalies,
  PgOperatorAuditRepository,
  PgOperatorRepository,
} from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";

/** Failed attempts within the window that trip the spike alert. */
const FAILURE_SPIKE_THRESHOLD = 5;
const FAILURE_SPIKE_WINDOW_SECONDS = 900; // 15 min

@Injectable()
export class OperatorAnomalyService {
  private readonly logger = new Logger(OperatorAnomalyService.name);

  constructor(
    @Inject(PgOperatorAuditRepository)
    private readonly audit: PgOperatorAuditRepository,
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /**
   * Evaluate a SUCCESSFUL login for new-location / new-device anomalies. Must be
   * called BEFORE the current attempt is recorded, so history excludes it.
   */
  async evaluateLogin(
    operatorId: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    try {
      const history = await this.audit.getOperatorLoginHistory(operatorId);
      const reasons = detectLoginAnomalies(history, { ip, userAgent });
      if (reasons.length === 0) return;

      await this.audit.recordAuditEvent({
        operatorId,
        action: "AnomalousLogin",
        // audit_logs.result 只收 success/failure/denied（CHECK）；告警类别由 action 表达。
        // 写 "alert" 会整条被拒——此前异常登录从未落库，提醒邮件也从未发出。
        result: "success",
        resourceId: operatorId,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
        metadata: { reasons },
      });
      await this.alertOperator(
        operatorId,
        "Vxture 运营账号异常登录提醒",
        `检测到您的运营账号发生了异常登录（${reasons.join(", ")}）。\n` +
          `IP：${ip ?? "未知"}\n设备：${userAgent ?? "未知"}\n\n` +
          `如非本人操作，请立即重置密码并检查通行密钥/验证器绑定。`,
      );
    } catch (err) {
      this.logger.warn(`evaluateLogin failed: ${String(err)}`);
    }
  }

  /**
   * Evaluate a failed second factor for a failure spike. Alerts once, when the
   * window count first reaches the threshold (== compare avoids re-alerting).
   */
  async evaluateFailureSpike(
    operatorId: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    try {
      const count = await this.audit.countRecentOperatorFailures(
        operatorId,
        FAILURE_SPIKE_WINDOW_SECONDS,
      );
      if (count !== FAILURE_SPIKE_THRESHOLD) return;

      await this.audit.recordAuditEvent({
        operatorId,
        action: "LoginFailureSpike",
        result: "success",
        resourceId: operatorId,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          count,
          windowSeconds: FAILURE_SPIKE_WINDOW_SECONDS,
        },
      });
      await this.alertOperator(
        operatorId,
        "Vxture 运营账号登录失败激增提醒",
        `您的运营账号在 ${FAILURE_SPIKE_WINDOW_SECONDS / 60} 分钟内连续登录失败 ` +
          `${count} 次（最近 IP：${ip ?? "未知"}）。\n\n` +
          `如非本人操作，您的账号可能正被尝试爆破，请检查并加固。`,
      );
    } catch (err) {
      this.logger.warn(`evaluateFailureSpike failed: ${String(err)}`);
    }
  }

  /** Email the affected operator if an address is on file (best-effort). */
  private async alertOperator(
    operatorId: string,
    subject: string,
    text: string,
  ): Promise<void> {
    const operator = await this.operators.findById(operatorId);
    if (!operator?.email) return;
    await this.mail.send({ to: operator.email, subject, text });
  }
}
