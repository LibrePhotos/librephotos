import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import "./controls.css";

export function NavLink({
  icon: I,
  label,
  end,
  active,
  dimmed,
  onClick,
  title,
  testId,
}: {
  icon: Icon;
  label: ReactNode;
  end?: ReactNode;
  active?: boolean;
  dimmed?: boolean;
  onClick(): void;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`nav-link${dimmed ? " dimmed" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      title={title}
      data-testid={testId}
    >
      <span className="nav-link-icon">
        <I size={18} stroke={1.75} aria-hidden="true" />
      </span>
      <span className="nav-link-label">{label}</span>
      {end !== undefined && <span className="nav-link-end">{end}</span>}
    </button>
  );
}
