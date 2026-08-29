/**
 * dev-fallback.utils.ts — 「dev 回退实现」的统一选择器，生产环境 fail-closed。
 * @package @vxture/core-utils
 *
 * 平台里有一类 provider 工厂：真实实现要一份配置（数据库连接、SMTP 口令…），配置
 * 缺失时换成一个开发用的假实现（内存仓库、把邮件打到 stdout）。2026-08-30 审计发现
 * 其中三处没有生产守卫——线上一次注入遗漏，假实现就静默顶上，而且没有任何报错；
 * 这种坏法比启动失败隐蔽得多（内存用户仓库还内置一个仓库公开的口令哈希）。
 *
 * 规则只有一条，所以只写一次：配置齐 → 真实现；配置缺 → 生产抛错（点名模块、缺
 * 的配置与被拒绝的假实现），非生产告警一次后回退。判据用 NODE_ENV（`isProduction()`），
 * 与 service-sms 既有的 fail-closed 一致；不用各模块自己的 config.isProduction——
 * 那些模块往往只注册了 database 域，app 域是空的，isProduction 恒为 false。
 *
 * 告警走调用方传进来的 `warn`，本包不依赖 Nest 的 Logger。
 */

import { isProduction } from "./env.utils";

export interface DevFallbackChoice<T> {
  /** 出现在错误 / 告警里的模块名，如 "AccountModule"。 */
  scope: string;
  /** 真实现所需的配置是否齐备。 */
  configured: boolean;
  real: T;
  fallback: T;
  /** 假实现的名字，如 "MockUserRepository"。 */
  fallbackName: string;
  /** 缺了什么，如 "数据库未配置（DATABASE_URL 与 DB_PASSWORD 均为空）"。 */
  missing: string;
  warn: (message: string) => void;
}

/**
 * 选出 provider 背后的实现。
 *
 * @throws {Error} 生产环境且 `configured` 为 false
 */
export function chooseDevFallback<T>(choice: DevFallbackChoice<T>): T {
  if (choice.configured) return choice.real;

  if (isProduction()) {
    throw new Error(
      `[${choice.scope}] ${choice.missing}，生产环境拒绝回退到 ${choice.fallbackName}`,
    );
  }
  choice.warn(`${choice.missing}，使用 ${choice.fallbackName} —— 仅限非生产`);
  return choice.fallback;
}
