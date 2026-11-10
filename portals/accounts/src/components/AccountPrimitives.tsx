/**
 * Console-aligned page headings, sections and account field rows.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
import type { ReactNode } from "react";
import { Card, Icon, type IconName } from "@vxture/design-system";

/** Separate section mutations from the editable values above them. */
export function AccountActions({ children }: { children: ReactNode }) {
  return <div className="accounts-section-actions">{children}</div>;
}

/** Render one page heading with the shared icon scale. */
export function AccountHeading({
  title,
  icon = "user",
  action,
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <header className="accounts-page-heading">
      <Icon name={icon} />
      <h1>{title}</h1>
      {action}
    </header>
  );
}

/** Render a standard section without introducing a second card vocabulary. */
export function AccountSection({
  title,
  icon = "user",
  action,
  tone = "default",
  children,
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <Card
      className={`accounts-section${tone === "danger" ? " accounts-section-danger" : ""}`}
      style={{ backgroundImage: "none" }}
    >
      <div className="accounts-section-heading">
        <Icon name={icon} size="md" />
        <h2>{title}</h2>
        {action}
      </div>
      <div className="accounts-section-body">{children}</div>
    </Card>
  );
}

/** Keep labels aligned with the section title and actions at the row end. */
export function AccountRow({
  label,
  children,
  action,
}: {
  label: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="accounts-row">
      <span className="accounts-row-label">{label}</span>
      <div className="accounts-row-value">{children}</div>
      {action}
    </div>
  );
}
