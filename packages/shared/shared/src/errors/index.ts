/**
 * errors/index.ts - 错误模块统一导出
 * @package @vxture-platform/shared
 * @description
 *   错误类和错误类型的统一导出入口
 */

export {
  VxtureError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  isVxtureError,
} from "./common.error";
