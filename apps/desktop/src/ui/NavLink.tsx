import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import "./controls.css";

/** A sidebar row of the web app (SideMenuNarrow .link): a full pill, the current page tinted. */
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
  /** At the row's end, dimmed (a count). */
  end?: ReactNode;
  active?: boolean;
  /** A quiet secondary row ("Add a folder", like the web's "Customize sidebar"). */
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
