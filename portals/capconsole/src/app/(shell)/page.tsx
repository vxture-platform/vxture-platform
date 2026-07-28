"use client";

/* Overview — the shell's only own page. Lists mounted provider admin modules
 * (the real management surfaces) using existing shell-template chrome classes
 * only; the shell ships no local CSS and no inline design styles by design. */

import { capNavSections } from "@/config/navigation";

const moduleItems =
  capNavSections.find((s) => s.title === "能力模块")?.items ?? [];

export default function OverviewPage() {
  return (
    <>
      <h1>能力控制台总览</h1>
      <p>
        OSS 侧运维面:L1 能力平台(Atlas / Runa)的管理模块统一在此挂载。
        外壳只负责 workforce SSO、导航与审计钩子;各模块由 provider
        自己的仓库交付并独立部署(product_250 M-4,联邦一档 = 路径挂载)。
      </p>

      {moduleItems.map((mod) => (
        <div key={mod.href} className="side-foot-card">
          <div className="sfc-top">
            <i className={"ph-fill " + mod.icon}></i>
            <span>{mod.label}</span>
          </div>
          <div className="sfc-meta">{mod.description}</div>
          <div className="sfc-meta">
            {mod.pending ? (
              <span>
                <i className="ph ph-clock"></i> 挂载位已预留,模块待接入
              </span>
            ) : (
              <a href={mod.href}>
                进入模块 <i className="ph ph-arrow-right"></i>
              </a>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
