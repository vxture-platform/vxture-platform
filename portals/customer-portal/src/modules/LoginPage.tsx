/**
 * Institutional access gateway for embodied intelligence and spatial services.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */
import type { CSSProperties } from "react";
import { Button, Icon } from "@vxture/design-system";
import type { PortalBrand } from "../lib/contracts";
import { BrandIdentity } from "./BrandIdentity";
import { SpatialScene } from "./SpatialScene";
import "./embodied-login.css";

// ============================================================================
// Public institution identity and authenticated entry
// ============================================================================
/** Keep the physical-world context visible without disclosing operational data. */
export function LoginPage({
  brand,
  designPreview = false,
  accessDenied = false,
}: {
  brand: PortalBrand;
  designPreview?: boolean;
  accessDenied?: boolean;
}) {
  const style = { "--portal-brand": brand.brandColor } as CSSProperties;
  return (
    <main className="embodied-gateway" style={style}>
      <a className="research-skip" href="#sign-in">
        跳到登录
      </a>
      <div className="embodied-scene" aria-hidden="true">
        {brand.background ? (
          <div
            className="embodied-background"
            style={{
              backgroundImage: `url(/api/portal/assets/${brand.background})`,
            }}
          />
        ) : (
          <SpatialScene />
        )}
      </div>
      <div className="embodied-vignette" />
      <header className="embodied-header">
        <BrandIdentity brand={brand} inverse caption="具身智能 · 空间服务" />
        <div className="embodied-header-meta">
          <span>EMBODIED INTELLIGENCE</span>
          <i />
          <span>机构专属门户</span>
        </div>
      </header>
      <div className="embodied-body">
        <section
          className="embodied-positioning"
          aria-labelledby="platform-title"
        >
          <div className="embodied-kicker">
            <span />
            物理世界的智能协同基础设施
          </div>
          <h1 id="platform-title">{brand.title}</h1>
          <p className="embodied-description">{brand.subtitle}</p>
          <div className="embodied-domains">
            <span>空间感知</span>
            <b>/</b>
            <span>场景建模</span>
            <b>/</b>
            <span>协同执行</span>
          </div>
        </section>
        <section
          className="embodied-access"
          aria-labelledby="sign-in-title"
          id="sign-in"
        >
          <div className="embodied-access-top">
            <span className="embodied-access-mark">
              <Icon name="lock" size="md" />
            </span>
            <span>AUTHORIZED ACCESS</span>
          </div>
          <h2 id="sign-in-title">平台登录</h2>
          <p className="embodied-access-description">
            请使用本机构授权账号访问空间服务与智能应用。
          </p>
          {accessDenied && (
            <p className="embodied-access-error" role="alert">
              当前账号未获得本机构的访问权限，请切换账号或联系机构管理员。
            </p>
          )}
          <div className="embodied-auth-provider">
            <Icon name="shield" size="sm" />
            <span>机构统一身份认证</span>
            <span className="embodied-auth-code">SSO</span>
          </div>
          <Button asChild size="lg" className="embodied-sign-in">
            <a href={designPreview ? "/workspace" : "/auth/login"}>
              <span>登录</span>
              <span className="embodied-sign-in-arrow">
                <Icon name="arrow-right" size="md" />
              </span>
            </a>
          </Button>
          <p className="embodied-access-note">
            <Icon name="lock" size="sm" />
            仅限本机构授权人员访问
          </p>
          <div className="embodied-access-divider" />
          <div className="embodied-access-support">
            <span>账号与访问权限</span>
            <p>如需开通或调整权限，请联系机构管理员。</p>
          </div>
          <div className="embodied-access-bottom">
            <span>机构专属访问入口</span>
            <span aria-hidden="true">↗</span>
          </div>
        </section>
      </div>
      <div className="embodied-caption" aria-hidden="true">
        <span className="embodied-caption-rule" />
        <div>
          <strong>空间理解 · 智能体协同</strong>
          <span>SPATIAL PERCEPTION / AGENT ORCHESTRATION</span>
        </div>
        <span className="embodied-coordinate">X — Y — Z</span>
      </div>
      <footer className="embodied-footer">
        <span>© {brand.name}</span>
        <div>
          <span>由 VXTURE 提供平台服务</span>
          <i />
          <a
            href="https://vxture.com/zh-CN/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            隐私政策
          </a>
          <a
            href="https://vxture.com/zh-CN/legal/terms"
            target="_blank"
            rel="noopener noreferrer"
          >
            服务条款
          </a>
        </div>
      </footer>
    </main>
  );
}
