import type { ReactNode } from "react";
import { Loader } from "./Button";
import "./controls.css";

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
