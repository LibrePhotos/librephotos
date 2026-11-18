import type { Icon } from "@tabler/icons-react";
import { forwardRef } from "react";

export type IconButtonProps = {
  icon: Icon;
  label: string;
  /** Shown in the tooltip and the accessible name ("Delete (Del)"). */
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  /** A toggle that is on: drawn filled and announced with aria-pressed. */
  pressed?: boolean;
  /** Tooltip aligned to the button's right edge (buttons near the window's right edge). */
  tipEnd?: boolean;
  /** No tooltip (the label is still the accessible name). */
  noTip?: boolean;
  /** Hidden when the window is narrow: 1 below 900 px, 2 below 680 px (the top bar's .opt-N). */
  optional?: 1 | 2;
  /** md: 40 px with a 20 px icon (toolbars); sm: 28 px with a 16 px icon (inline). */
  size?: "md" | "sm";
  className?: string;
};

/** The round subtle icon button of the web app (Mantine ActionIcon variant="subtle" radius="xl"). */
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
