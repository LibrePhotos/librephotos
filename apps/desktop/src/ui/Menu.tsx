import { IconDots, type Icon } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./IconButton";

export type MenuItem = {
  icon: Icon;
  label: string;
  /** Shown dimmed at the end of the row ("Ctrl+C"). */
  shortcut?: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  /** Extra class on the row's wrapper, e.g. to show an item only in narrow windows. */
  className?: string;
};

type Props = {
  /** The trigger's label (tooltip and accessible name) and the menu's name. */
  label: string;
  /** Groups of items, with a divider between groups. */
  groups: MenuItem[][];
  icon?: Icon;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  /** Extra class on the trigger. */
  triggerClassName?: string;
};

/**
 * A button that opens a menu below it: arrow keys, Home and End move, Enter picks, Escape and Tab
 * close; while open, keys belong to the menu (the viewer's shortcuts never see them). The menu
 * keeps the app's colour scheme inside the dark viewer (.lp-app-scheme), as the web app's do.
 */
export function Menu({ label, groups, icon = IconDots, align = "end", triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    /** Enabled items that are shown (narrow-only items may be display: none). */
    const items = () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])].filter(
        b => b.offsetParent !== null,
      );
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.stopPropagation();
        if (e.key === "Escape") e.preventDefault();
        close(e.key === "Escape");
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        // Let the focused item's own click happen, but keep the viewer from seeing the key.
        e.stopPropagation();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
      const buttons = items();
      if (buttons.length === 0) return;
      const at = buttons.findIndex(b => b === document.activeElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const onBlur = () => close(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    items()[0]?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <IconButton
        ref={buttonRef}
        icon={icon}
        label={label}
        pressed={open}
        noTip={open}
        tipEnd={align === "end"}
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
      />
      {open && (
        <div ref={menuRef} className={`menu lp-app-scheme${align === "start" ? " start" : ""}`} role="menu" aria-label={label}>
          {groups.map((group, g) => (
            <div key={g} className="menu-group" role="group">
              {g > 0 && <div className="menu-sep" role="separator" />}
              {group.map(({ icon: I, label: itemLabel, shortcut, onSelect, disabled, danger, className }) => (
                <div key={itemLabel} className={className}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`menu-item${danger ? " danger" : ""}`}
                    disabled={disabled}
                    aria-keyshortcuts={shortcut}
                    onClick={() => {
                      setOpen(false);
                      buttonRef.current?.focus();
                      onSelect();
                    }}
                  >
                    <I size={18} stroke={1.75} aria-hidden="true" />
                    <span className="menu-label">{itemLabel}</span>
                    {shortcut && <span className="menu-shortcut">{shortcut}</span>}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
