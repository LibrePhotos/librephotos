import type { ReactNode } from "react";
import { Loader } from "./Button";
import "./controls.css";

/**
 * The header of every page (web components/PageHeader.tsx): a 26px/700 title with an optional
 * spinner, one dimmed meta line under it ("2,557 photos · 312 days"), and the page's actions on
 * the right, centred on the title and its meta line.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  loading,
  testId,
  narrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  testId?: string;
  /** A settings-type page: as wide as its reading column (920 px), so the actions line up with it. */
  narrow?: boolean;
}) {
  return (
    <header className={`page-header${narrow ? " narrow" : ""}`}>
      <div className="page-header-text" data-testid={testId}>
        <h1 className="page-title">
          {title}
          {loading && <Loader size={18} className="page-title-loader" />}
        </h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
