"use client";

/**
 * Shared cards and application-center filtering using published DS controls.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { useState } from "react";
import {
  Badge,
  Button,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  SegmentedControl,
  type IconName,
} from "@vxture/design-system";
import type { WorkApp } from "../../lib/contracts";
import {
  filterApps,
  RELEASE_LABELS,
  TIER_LABELS,
} from "../../lib/presentation";
import type { Category } from "../../lib/presentation";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "agent", label: "专业智能体" },
  { value: "platform", label: "知识与数据" },
];
const PRODUCT_ICONS: Record<string, IconName> = {
  tenderforge: "edit",
  tender: "edit",
  bidproposal: "folder",
  solution: "folder",
  karda: "file",
  knowledge: "file",
  arda: "database",
  data: "database",
  yucer: "users",
  contractaudit: "shield",
  contract: "shield",
  review: "shield",
};
const TONES = ["brand", "violet", "teal", "amber"] as const;

// ============================================================================
// Presentation composition
// ============================================================================
/**
 * Render an entire-card overview target and an independent product entry action.
 * @param props - Current application and drawer callback.
 * @returns A keyboard-accessible application card.
 */
export function AppCard({
  app,
  onOverview,
}: {
  app: WorkApp;
  onOverview: (app: WorkApp) => void;
}): React.JSX.Element {
  const tone =
    TONES[
      Array.from(app.code).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        TONES.length
    ];
  return (
    <article className="work-app-card">
      <Button
        type="button"
        variant="ghost"
        className="work-card-target"
        aria-label={`查看${app.name}的概要`}
        onClick={() => onOverview(app)}
      />
      <div className="work-card-content">
        <div className="work-card-identity">
          <span
            className={`work-app-glyph work-tone-${tone}`}
            aria-hidden="true"
          >
            {app.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={app.icon} alt="" width={24} height={24} />
            ) : (
              <Icon
                name={
                  PRODUCT_ICONS[app.code] ??
                  (app.category === "agent" ? "sparkles" : "database")
                }
                size="lg"
              />
            )}
          </span>
          <div className="work-app-name">
            <h3 title={app.name}>{app.name}</h3>
            {app.brand && (
              <p className="work-app-brand" title={app.brand}>
                {app.brand}
              </p>
            )}
          </div>
          <div className="work-card-badges">
            {app.tier && (
              <Badge variant="outline" className="work-plan-badge">
                {TIER_LABELS[app.tier] ?? app.tier}
              </Badge>
            )}
            {RELEASE_LABELS[app.stage] && (
              <Badge
                variant="outline"
                className={`work-release-badge work-release-${app.stage}`}
              >
                {RELEASE_LABELS[app.stage]}
              </Badge>
            )}
          </div>
        </div>
        <p className="work-app-description">
          {app.description || "产品介绍暂未提供"}
        </p>
      </div>
      <div className="work-app-actions">
        <span className="work-app-version">
          {app.version ? `v${app.version.replace(/^v/, "")}` : ""}
        </span>
        {app.available && app.href ? (
          <Button asChild size="sm" className="work-action">
            <a
              href={app.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`进入${app.name}（新标签页）`}
            >
              进入
            </a>
          </Button>
        ) : (
          <span className="work-app-unavailable">{app.availabilityLabel}</span>
        )}
      </div>
    </article>
  );
}

/**
 * Compose the catalog toolbar and filtered cards without a redundant result row.
 * @param props - Real catalog applications and overview action.
 * @returns Search, availability selection, contextual counts and cards.
 */
export function AppCatalog({
  apps,
  onOverview,
}: {
  apps: WorkApp[];
  onOverview: (app: WorkApp) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<"all" | "available">("all");
  const [category, setCategory] = useState<Category>("all");
  const result = filterApps(
    apps,
    query,
    availability === "available",
    category,
  );
  return (
    <section aria-label="应用目录" className="work-catalog">
      <div className="work-catalog-toolbar">
        <div
          role="group"
          aria-label="应用分类"
          className="work-category-filters"
        >
          {CATEGORIES.map((item) => (
            <Button
              key={item.value}
              variant="ghost"
              size="sm"
              aria-pressed={category === item.value}
              className="work-category-filter"
              onClick={() => setCategory(item.value)}
            >
              {item.label}
              <span className="text-body-sm tabular-nums">
                {result.counts[item.value]}
              </span>
            </Button>
          ))}
        </div>
        <div className="work-toolbar-actions">
          <InputGroup className="work-search">
            <InputGroupAddon>
              <Icon name="search" size="sm" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="搜索应用"
              placeholder="搜索名称或业务能力"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <div
            className="work-availability"
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "all"
                  : event.key === "End"
                    ? "available"
                    : availability === "all"
                      ? "available"
                      : "all";
              setAvailability(next);
              const radios =
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[role=radio]",
                );
              radios[next === "all" ? 0 : 1]?.focus();
            }}
          >
            <SegmentedControl<"all" | "available">
              ariaLabel="应用可用性"
              value={availability}
              items={[
                { value: "all", label: "全部" },
                { value: "available", label: "可用" },
              ]}
              onChange={setAvailability}
            />
          </div>
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {result.items.length} 个匹配应用
      </div>
      {result.items.length ? (
        <div className="work-app-grid">
          {result.items.map((app) => (
            <AppCard key={app.code} app={app} onOverview={onOverview} />
          ))}
        </div>
      ) : (
        <div className="work-empty">
          <Icon name="search" size="lg" />
          <h3>没有找到相关应用</h3>
          <p className="text-body-sm text-muted-foreground">
            试试其他关键词，或调整应用分类
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setAvailability("all");
              setCategory("all");
            }}
          >
            重置筛选
          </Button>
        </div>
      )}
    </section>
  );
}
