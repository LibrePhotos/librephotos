import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { IconButton } from "./IconButton";

export function Panel({
  title,
  onClose,
  closeLabel = "Close",
  className,
  label,
  children,
}: {
  title: string;
  onClose?(): void;
  closeLabel?: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <aside className={`panel${className ? ` ${className}` : ""}`} aria-label={label ?? title}>
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
        {onClose && <IconButton icon={IconX} label={closeLabel} onClick={onClose} noTip />}
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );
}

export function DetailRow({
  icon: I,
  title,
  sub,
  children,
  label,
}: {
  icon: Icon;
  title: ReactNode;
  sub?: ReactNode[];
  children?: ReactNode;
  label?: string;
}) {
  return (
    <div className="detail-row" role="group" aria-label={label}>
      <I className="detail-icon" size={20} stroke={1.5} aria-hidden="true" />
      <div className="detail-body">
        <div className="detail-title">{title}</div>
        {sub?.map((line, i) =>
          line === null || line === undefined || line === false ? null : (
            <div key={i} className="detail-sub">
              {line}
            </div>
          ),
        )}
        {children}
      </div>
    </div>
  );
}
