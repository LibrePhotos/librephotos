import type { Icon } from "@tabler/icons-react";
import { forwardRef } from "react";

export type IconButtonProps = {
  icon: Icon;
  label: string;
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
  tipEnd?: boolean;
  noTip?: boolean;
  optional?: 1 | 2;
  size?: "md" | "sm";
  className?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: I, label, shortcut, onClick, disabled, pressed, tipEnd, noTip, optional, size = "md", className },
  ref,
) {
  const classes = ["icon-btn", size === "sm" && "small", pressed && "pressed", optional && `opt-${optional}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      data-tip={noTip ? undefined : shortcut ? `${label}  ${shortcut}` : label}
      data-tip-end={tipEnd ? "" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <I size={size === "sm" ? 16 : 20} stroke={size === "sm" ? 1.75 : 2} aria-hidden="true" />
    </button>
  );
});
