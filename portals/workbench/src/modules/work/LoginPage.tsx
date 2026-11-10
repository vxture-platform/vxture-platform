"use client";

/**
 * Branded sign-in surface retaining the approved workspace composition.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { withLocalePreference } from "@vxture/platform-browser";
import { useWorkLocale } from "../../lib/locale";
import { Button, Icon } from "@vxture/design-system";
import { SITE_FILINGS } from "@vxture-platform/shared";
import type { WorkRuntime } from "../../lib/contracts";

// ============================================================================
// Decorative workspace landscape; shares the approved preview geometry.
// ============================================================================
function LoginArtwork(): React.JSX.Element {
  return (
    <div className="work-login-artwork" aria-hidden="true">
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="work-floor-fade"
            x1="0"
            y1="570"
            x2="0"
            y2="1000"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".45" stopColor="white" stopOpacity=".65" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="work-floor-mask">
            <path d="M0 0H1600V1000H0Z" fill="url(#work-floor-fade)" />
          </mask>
          <linearGradient
            id="work-flow"
            x1="0"
            y1="850"
            x2="1400"
            y2="540"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--primary)" stopOpacity="0" />
            <stop offset=".3" stopColor="var(--primary)" stopOpacity=".16" />
            <stop offset=".6" stopColor="var(--info)" stopOpacity=".12" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="work-edge"
            x1="200"
            y1="650"
            x2="980"
            y2="850"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--primary)" stopOpacity=".05" />
            <stop offset=".4" stopColor="var(--primary)" stopOpacity=".4" />
            <stop offset="1" stopColor="var(--info)" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="work-glass"
            x1="230"
            y1="610"
            x2="650"
            y2="860"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--card)" stopOpacity=".75" />
            <stop
              offset=".5"
              stopColor="var(--primary-muted)"
              stopOpacity=".45"
            />
            <stop offset="1" stopColor="var(--primary)" stopOpacity=".08" />
          </linearGradient>
          <linearGradient
            id="work-side"
            x1="300"
            y1="690"
            x2="550"
            y2="900"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--primary)" stopOpacity=".1" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity=".015" />
          </linearGradient>
        </defs>
        <g
          mask="url(#work-floor-mask)"
          stroke="var(--primary)"
          strokeWidth=".7"
          opacity=".09"
        >
          {Array.from({ length: 11 }, (_, index) => (
            <path key={index} d={`M800 590 ${-700 + index * 290} 1060`} />
          ))}
          {[685, 730, 790, 870, 975].map((y) => (
            <path key={y} d={`M-400 ${y}H2000`} />
          ))}
        </g>
        <g opacity=".55">
          <path
            d="M-200 990C100 1020 260 715 610 698S1080 810 1410 520L1750 470C1300 1030 995 840 650 785S120 1170-200 1090Z"
            fill="url(#work-flow)"
          />
          <path
            d="M-200 990C100 1020 260 715 610 698S1080 810 1410 520"
            stroke="url(#work-edge)"
            strokeWidth="1.2"
          />
          <path
            d="M-100 1040C210 1060 330 792 670 766S1130 870 1510 550"
            stroke="url(#work-edge)"
            strokeWidth=".7"
            opacity=".5"
          />
        </g>
        <g opacity=".48">
          <path
            d="m240 787 215-124 215 124-215 124Z"
            fill="url(#work-glass)"
            stroke="url(#work-edge)"
          />
          <path
            d="M240 787v15l215 124 215-124v-15L455 911Z"
            fill="url(#work-side)"
          />
          <path
            d="m278 737 177-102 177 102-177 102Z"
            fill="url(#work-glass)"
            stroke="url(#work-edge)"
          />
          <path
            d="M278 737v12l177 102 177-102v-12L455 839Z"
            fill="url(#work-side)"
          />
          <path
            d="m322 684 133-77 133 77-133 77Z"
            fill="url(#work-glass)"
            stroke="url(#work-edge)"
          />
          <path
            d="M322 684v11l133 77 133-77v-11L455 761Z"
            fill="url(#work-side)"
          />
          <g
            stroke="var(--primary)"
            strokeWidth="1"
            strokeLinecap="round"
            opacity=".22"
          >
            <path d="m366 680 62-36 88 51-62 36Z" />
            <path d="m387 684 35-20m-22 28 35-20m-21 28 24-14" />
            <path d="m478 661 28-16 43 25-28 16Z" />
            <path d="m478 712 19-11m-7 18 37-21" />
          </g>
          <path
            d="m681 760 77-44 77 44-77 45Z"
            fill="url(#work-glass)"
            stroke="url(#work-edge)"
            opacity=".7"
          />
          <path
            d="m153 726 52-30 52 30-52 30Z"
            fill="url(#work-glass)"
            stroke="url(#work-edge)"
            opacity=".55"
          />
          <path
            d="m588 684 100 58 70-40M322 684l-74 43-43-25"
            stroke="var(--primary)"
            strokeOpacity=".16"
            strokeDasharray="3 7"
          />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Public identity and legal content; no fictional organization or account.
// ============================================================================
/**
 * Compose the production login surface around the existing central OIDC action.
 * @param props - Readiness, recoverable errors and the authorized login action.
 * @returns The branded sign-in story, card and shared legal footer.
 */
export function LoginPage({
  runtime,
  error,
  retry,
  signIn,
}: {
  runtime: WorkRuntime;
  error: { code: number; message: string } | null;
  retry: () => void;
  signIn: () => void;
}): React.JSX.Element {
  const { locale, t } = useWorkLocale();
  const failed = error !== null && error.code !== 401;
  const website = new URL(`/${locale}`, runtime.websiteUrl).href;
  return (
    <>
      <LoginArtwork />
      <main id="main" className="work-login-main">
        <section
          className="work-login-story"
          aria-labelledby="login-story-title"
        >
          <p className="work-login-kicker">EXPERTISE, CONNECTED</p>
          <h1 id="login-story-title">
            {t("汇聚专业智能体")}
            <br />
            <span>{t("贯通云端与桌面")}</span>
          </h1>
          <p className="work-login-description">
            {t("连接业务应用与团队知识，")}
            <br />
            {t("让工作在不同终端之间自然延续")}
          </p>
          <p className="work-login-capabilities">
            <Icon name="sparkles" size="sm" />
            <span>{t("知识复用")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("团队协作")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("多端同步")}</span>
          </p>
        </section>
        <section className="work-login-panel" aria-labelledby="login-title">
          <div className="work-login-heading">
            <p className="work-login-eyebrow">WELCOME TO RUYIN WORK</p>
            <h2 id="login-title">
              {failed ? t("工作空间暂不可用") : t("登录你的工作空间")}
            </h2>
          </div>
          <div className="work-login-actions">
            <div className="work-login-identity">
              <span>
                <Icon name="user" size="lg" />
              </span>
              <div>
                <strong>{t("全局统一账号")}</strong>
                <p>{t("账号、单位与工作空间，一处连接")}</p>
              </div>
            </div>
            {(!runtime.authConfigured || failed) && (
              <p role="status" className="work-login-error">
                {!runtime.authConfigured
                  ? t("登录服务暂不可用，请稍后再试")
                  : error && t(error.message)}
              </p>
            )}
            <Button
              className="work-login-cta"
              disabled={!runtime.authConfigured}
              onClick={failed ? retry : signIn}
            >
              {failed ? t("重新连接") : t("继续登录")}
              <Icon name="arrow-right" size="sm" />
            </Button>
          </div>
          <p className="work-login-security">
            <Icon name="shield" size="sm" />
            {t("使用平台账号安全登录")}
          </p>
        </section>
      </main>
      <footer className="work-legal-footer">
        <div>
          <span>
            © {new Date().getFullYear()} VXTURE{" "}
            <span aria-hidden="true">|</span> RUYIN
          </span>
          <nav aria-label={t("法律信息")}>
            <a
              href={withLocalePreference(`${website}/legal/terms`, locale)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("服务条款")}
            </a>
            <a
              href={withLocalePreference(`${website}/legal/privacy`, locale)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("隐私政策")}
            </a>
            <a
              href={withLocalePreference(`${website}/legal/copyright`, locale)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("版权声明")}
            </a>
          </nav>
        </div>
        <nav aria-label={t("网站备案")}>
          {SITE_FILINGS.map((filing) => (
            <a
              key={filing.link}
              href={filing.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {filing.text}
            </a>
          ))}
        </nav>
      </footer>
    </>
  );
}
