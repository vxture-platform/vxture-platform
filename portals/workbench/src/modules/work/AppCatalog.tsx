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
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  SegmentedControl,
} from "@vxture/design-system";
import type { WorkApp } from "../../lib/contracts";
import { filterApps } from "../../lib/presentation";
import type { Category } from "../../lib/presentation";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "agent", label: "专业智能体" },
  { value: "platform", label: "知识与数据" },
];
const STAGES: Record<string, string> = {
  preview: "预览版",
  beta: "公测版",
  stable: "正式版",
  sunset: "停售中",
};

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
  return (
    <article className="work-app-card">
      <Button
        variant="ghost"
        className="work-card-target"
        aria-label={`查看${app.name}的概要`}
        onClick={() => onOverview(app)}
      />
      <div className="pointer-events-none relative flex flex-1 flex-col gap-md">
        <div className="work-card-identity">
          <Avatar className="size-media-sm rounded-lg">
            <AvatarImage src={app.icon ?? undefined} alt="" />
            <AvatarFallback className="rounded-lg bg-primary-muted text-primary-text">
              {app.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h3 className="whitespace-nowrap text-title-lg">{app.name}</h3>
            {app.brand && (
              <p
                className="truncate text-body-sm text-muted-foreground"
                title={app.brand}
              >
                {app.brand}
              </p>
            )}
          </div>
          <div className="work-card-badges">
            {app.tier && <Badge variant="outline">{app.tier}</Badge>}
            {STAGES[app.stage] && (
              <Badge variant="secondary">{STAGES[app.stage]}</Badge>
            )}
          </div>
        </div>
        <p className="text-body-md text-muted-foreground">
          {app.description || "产品介绍暂未提供"}
        </p>
      </div>
      <div className="relative mt-lg flex items-center justify-between gap-md">
        <span className="pointer-events-none text-body-sm text-muted-foreground">
          {app.version ? `v${app.version.replace(/^v/, "")}` : "版本待发布"}
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
          <span className="text-body-sm text-muted-foreground">
            {app.availabilityLabel}
          </span>
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
    <section aria-label="应用目录" className="flex flex-col gap-lg">
      <div className="work-catalog-toolbar">
        <div
          role="group"
          aria-label="应用分类"
          className="flex flex-wrap gap-xs"
        >
          {CATEGORIES.map((item) => (
            <Button
              key={item.value}
              variant="ghost"
              size="sm"
              aria-pressed={category === item.value}
              className={
                category === item.value
                  ? "text-primary"
                  : "text-muted-foreground"
              }
              onClick={() => setCategory(item.value)}
            >
              {item.label}
              <span className="text-body-sm tabular-nums">
                {result.counts[item.value]}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-sm">
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
          <div className="work-availability">
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
          <p className="text-body-md text-muted-foreground">
            没有符合条件的应用
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
