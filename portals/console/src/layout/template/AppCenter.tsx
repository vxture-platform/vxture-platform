"use client";

/* 1:1 转写自设计稿 main-template.jsx AppCenterScreen. 应用数据为占位（静态），
 * 后续接 BFF「已订阅/已授权应用」。卡片点击切到控制台对应路由。 */

import type { CSSProperties } from "react";

export interface ConsoleApp {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tone: string;
  target: string;
  openVela?: boolean;
}

export interface AppCenterProps {
  apps: ConsoleApp[];
  onOpen: (app: ConsoleApp) => void;
  labels: {
    title: string;
    desc: string;
    shortcutTag: string;
    enter: string;
  };
}

export function AppCenter({ apps, onOpen, labels }: AppCenterProps) {
  return (
    <div className="screen appcenter">
      <div className="ac-head">
        <div className="ac-head-meta">
          <h1 className="ac-title">{labels.title}</h1>
          <p className="ac-desc">{labels.desc}</p>
        </div>
        <span className="ac-head-tag">
          <i className="ph ph-squares-four"></i>
          {labels.shortcutTag}
        </span>
      </div>
      <div className="ac-grid">
        {apps.map((a) => (
          <button
            key={a.id}
            className="ac-card"
            style={{ "--tone": a.tone } as CSSProperties}
            onClick={() => onOpen(a)}
          >
            <span className="ac-card-art" aria-hidden="true">
              <i className={"ph-fill " + a.icon}></i>
            </span>
            <div className="ac-card-head">
              <i
                className={"ph-fill " + a.icon + " ac-card-lead"}
                aria-hidden="true"
              ></i>
              <strong className="ac-card-name">{a.name}</strong>
            </div>
            <p className="ac-card-desc">{a.desc}</p>
            {/* The per-card status pill claimed these were subscribed
             * products. They are the console's own sections, so the claim
             * was removed rather than restated. */}
            <div className="ac-card-foot">
              <span className="ac-card-go">
                {labels.enter}
                <i className="ph ph-arrow-right"></i>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
