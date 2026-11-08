/**
 * index.ts - @vxture/service-mail 公共导出
 * @package @vxture/service-mail
 * @layer Domain
 * @category Barrel
 *
 * @author AI-Generated
 * @date 2026-05-02
 * @version 1.0
 * @copyright Vxture Team
 */

export { MailModule } from "./module/mail.module";
export { MailService } from "./service/mail.service";
export type { EmailCodePurpose } from "./service/verifycode.service";
export { VerifyCodeService } from "./service/verifycode.service";
export type { IMailProvider, MailMessage } from "./types/mail.types";
