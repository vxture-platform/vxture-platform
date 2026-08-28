/**
 * OnboardingChrome.tsx - 首次补齐页的单栏认证版式（console 本地组装）。
 * @package @vxture/console
 *
 * 认证形态组件族已迁出 design-system（owner 2026-08-18 判：DS 只收通用、
 * 无业务含义的件），现属 accounts。门户间禁互引，console 拿不到那一族——
 * 这里用 DS 通用件（Card / ShellBrand / ShellLegalFooter）把首次补齐需要的
 * **单栏档**就地组装出来，版式与 accounts 的登录卡同款：veil 叠层（strong 档）
 * 出血卡、rounded-xl、居中 max-w-panel-md、页眉 logo + 名称、页脚署名+法务。
 *
 * 重复的是几十行版式组合，换来的是层的干净；若哪天出现第三个门户要同款，
 * 再谈抽共享业务包，两个消费方不值得开一个包。
 */
"use client";

import type { ReactNode } from "react";
import {
  Card,
  ShellBrand,
  ShellLegalFooter,
  type ShellLegalFooterLink,
} from "@vxture/design-system";

export function OnboardingChrome({
  brandLabel,
  brandLogoSrc,
  copyright,
  legalLinks,
  title,
  description,
  children,
}: {
  readonly brandLabel: ReactNode;
  readonly brandLogoSrc?: string;
  readonly copyright: ReactNode;
  readonly legalLinks: ShellLegalFooterLink[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="relative flex min-h-screen flex-col bg-background">
      <header className="w-full px-lg py-md">
        <div className="mx-auto flex w-full max-w-page-xl items-center justify-between gap-md">
          <ShellBrand
            href="/"
            {...(brandLogoSrc ? { logoSrc: brandLogoSrc } : {})}
            label={brandLabel}
          />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-md py-xl">
        <Card
          surface="strong"
          aria-label="onboarding"
          className="w-full max-w-panel-md flex-row gap-0 overflow-hidden rounded-xl py-0"
        >
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-lg p-xl">
            <div className="flex flex-col gap-2xs">
              <h1 className="text-balance text-heading-3 text-foreground">
                {title}
              </h1>
              {description ? (
                <p className="text-body-sm text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {children}
          </div>
        </Card>
      </main>

      <ShellLegalFooter copyright={copyright} links={legalLinks} />
    </section>
  );
}
