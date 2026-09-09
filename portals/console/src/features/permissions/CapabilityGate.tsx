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
  /**
   * 只对这些租户类型开放(owner 2026-09-10)。
   *
   * 成员管理那几页要它:**个人租户只有自己**,邀请 / 新建 / 改角色 / 管权限在那里
   * 都没有意义。侧栏本来就按 `tenantTypes` 藏了入口,但那只是藏——从组织租户
   * 切到个人租户时页面还留在原地,按钮照样在。走查抓到的就是这个形状。
   *
   * 这一层与 BFF 的 `assertOrganizationTenant` 是**两道**,不是一道:
   * 这里让人看不到,那里让动作打不动。少任何一道都不够——
   * 只有前端就是可绕的,只有后端就是点了才报错。
   */
  readonly tenantTypes?: readonly ("personal" | "organization")[];
  readonly children: ReactNode;
}

export function CapabilityGate({
  capability,
  tenantTypes,
  children,
}: CapabilityGateProps) {
  const { session, status } = useConsoleSession();
  const t = useTranslations("access");
  // 权限码的人话标签与权限管理页共用一份词条(permissionsPage.perm),不再各写一套
  // (批 9 角色页与权限页拆开时,这份词条跟着码走进了 permissionsPage)。
  const tPerm = useTranslations("permissionsPage.perm");
  const router = useRouter();
  const required = Array.isArray(capability)
    ? (capability as readonly Capability[])
    : [capability as Capability];

  if (status !== "ready") return null;

  /* 租户类型不合先挡,理由与缺权限不同——不是「你没权限」,是「这个租户没有这件事」。
     文案也分开:对个人租户说「你没有访问权限」会让人去找管理员要权限,而没有人能给。 */
  const tenantType = session.tenant?.tenantType ?? null;
  if (tenantTypes && tenantType && !tenantTypes.includes(tenantType)) {
    return (
      <ViewLayout>
        <EmptyState
          icon="buildings"
          title={t("tenantTypeTitle")}
          description={t("tenantTypeDescription")}
          action={
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/")}
            >
              {t("back")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

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
