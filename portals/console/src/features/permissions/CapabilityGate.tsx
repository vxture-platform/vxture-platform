"use client";

/**
 * CapabilityGate — 页面级权限门(批 0a 权限配置体系)。
 * @package @vxture/console
 * @layer Application
 * @category Feature
 *
 * 导航过滤只是「不显示入口」,不是门:直接敲 URL 仍能进页面,页面再向 BFF 发请求
 * 拿 403,而 `readJson` 把 403 吞成空数组,用户看到的是一张「没有数据」的假空页。
 * 这里在页面挂载前按会话能力判一次,缺码就画一个说明原因的「没有访问权限」状态
 * (design/platform/20-console §状态设计:No-permission 要明确说是角色 / capability
 * 的原因,不能当通用报错),并给一条回总览的路。
 *
 * 判据与 BFF 守卫同一套(`@vxture/core-utils` capabilitySatisfies:`.manage` 蕴含
 * 同资源 `.read`),所以「看得到页」与「BFF 放行」不会再各说各话。
 * 会话未就绪时不判——外壳(ConsoleShell)已经在那之前挡住了。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ViewLayout } from "@vxture/design-system";
import { useRouter } from "@/lib/i18n/navigation";
import type { Capability } from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasAnyCapability } from "./can";

export interface CapabilityGateProps {
  /** 持有任一即放行。 */
  readonly capability: Capability | readonly Capability[];
  readonly children: ReactNode;
}

export function CapabilityGate({ capability, children }: CapabilityGateProps) {
  const { session, status } = useConsoleSession();
  const t = useTranslations("access");
  // 权限码的人话标签与角色页共用一份词条(rolesPage.perm),不再各写一套。
  const tPerm = useTranslations("rolesPage.perm");
  const router = useRouter();
  const required = Array.isArray(capability)
    ? (capability as readonly Capability[])
    : [capability as Capability];

  if (status !== "ready") return null;
  if (hasAnyCapability(session.capabilities, required)) return <>{children}</>;

  return (
    <ViewLayout>
      <EmptyState
        icon="shield-check"
        title={t("title")}
        description={t("description", {
          required: required
            .map((c) => tPerm(c.replace(/\./g, "_")))
            .join(" / "),
        })}
        action={
          <Button variant="outline" size="md" onClick={() => router.push("/")}>
            {t("back")}
          </Button>
        }
      />
    </ViewLayout>
  );
}
