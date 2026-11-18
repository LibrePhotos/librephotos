import type { Icon } from "@tabler/icons-react";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./controls.css";

export type ButtonVariant = "filled" | "default" | "light" | "subtle" | "neutral" | "danger";
export type ButtonSize = "compact" | "xs" | "sm" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /**
   * filled: the page's one main action (primary). default: the quiet grey pill. light: tinted
   * primary. subtle: primary text, no fill. neutral: the page toolbar's look (web toolbarLook()).
   * danger: deep red with white text.
   */
  variant?: ButtonVariant;
  /** compact 26 px, xs 30 px, sm 36 px (Mantine's default), lg 40 px (sign-in forms). */
  size?: ButtonSize;
  leftIcon?: Icon;
  fullWidth?: boolean;
  /** A spinner instead of the label; the button keeps its width and ignores clicks. */
  loading?: boolean;
  children: ReactNode;
};

const VARIANT: Record<ButtonVariant, string> = {
  filled: "primary",
  default: "",
  light: "light",
  subtle: "subtle",
  neutral: "subtle neutral",
  danger: "danger",
};

/** Mantine's Button in the LibrePhotos theme (web theme/variantColors.ts, controlsTheme.ts). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "sm",
    leftIcon: I,
    fullWidth,
    loading,
    className,
    children,
    type = "button",
    disabled,
    onClick,
    ...rest
  },
  ref,
) {
  const classes = ["btn", VARIANT[variant], size !== "sm" && size, fullWidth && "full", loading && "loading", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {I && <I size={size === "compact" || size === "xs" ? 14 : 16} stroke={1.75} aria-hidden="true" />}
      <span>{children}</span>
      {loading && <Loader size={size === "compact" ? 14 : 18} />}
    </button>
  );
});

/** Mantine's "oval" loader in the primary colour (or the current colour inside a button). */
export function Loader({ size = 18, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span
      className={`loader${className ? ` ${className}` : ""}`}
      style={{ "--loader-size": `${size}px` } as CSSProperties}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
