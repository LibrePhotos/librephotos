import type { Icon } from "@tabler/icons-react";
import { IconInfoCircle } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import "./controls.css";

export type Tone = "primary" | "gray" | "orange" | "teal" | "red";

/** Mantine's Badge, light variant: a small uppercase pill. */
export function Badge({
  tone = "primary",
  size = "sm",
  children,
  title,
}: {
  tone?: Tone;
  size?: "xs" | "sm";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge${tone === "primary" ? "" : ` ${tone}`}${size === "xs" ? " xs" : ""}`} title={title}>
      {children}
    </span>
  );
}

/**
 * Mantine's Progress: a rounded bar on a quiet track. `muted` adds a second, tinted section after
 * the first; `striped` animates the bar; `gray` draws a stopped (paused) one.
 */
export function Progress({
  value,
  muted = 0,
  size = 4,
  label,
  striped,
  gray,
  className,
}: {
  value: number;
  muted?: number;
  size?: number;
  label: string;
  striped?: boolean;
  gray?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const classes = ["progress", striped && "striped", gray && "gray", className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      style={{ "--progress-size": `${size}px` } as CSSProperties}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="progress-section" style={{ width: `${pct}%` }} />
      {muted > 0 && <div className="progress-section muted" style={{ width: `${Math.min(100 - pct, muted)}%` }} />}
    </div>
  );
}

/** Mantine's Card withBorder (radius lg): an optional title and dimmed description over its body. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** At the right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`} data-testid={testId}>
      {(title || description || actions) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-description">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Mantine's Alert, light variant, with an icon and an optional bold title. */
export function Alert({
  tone = "primary",
  icon: I = IconInfoCircle,
  title,
  children,
}: {
  tone?: "primary" | "red" | "orange";
  icon?: Icon;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`alert${tone === "primary" ? "" : ` ${tone}`}`} role={tone === "red" ? "alert" : "status"}>
      <I className="alert-icon" size={18} stroke={1.75} aria-hidden="true" />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Two initials in a round light chip (the web header's account avatar). */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const parts = name
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
  return (
    <span className="avatar" style={{ "--avatar-size": `${size}px` } as CSSProperties} aria-hidden="true">
      {initials}
    </span>
  );
}

/** The web's EmptyState: an 80px light icon, a title, a dimmed description and up to two actions. */
export function EmptyState({
  icon: I,
  title,
  description,
  children,
  primary,
  testId,
}: {
  icon: Icon;
  title: ReactNode;
  description?: ReactNode;
  /** The action buttons (a light primary, then a subtle secondary). */
  children?: ReactNode;
  /** The icon in the primary tint (a process under way) instead of grey. */
  primary?: boolean;
  testId?: string;
}) {
  return (
    <div className="empty" data-testid={testId}>
      <div className={`empty-icon${primary ? " primary" : ""}`} aria-hidden="true">
        <I size={40} stroke={1.5} />
      </div>
      <h2 className="empty-title">{title}</h2>
      {description && <p className="empty-description">{description}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
