import type { Icon } from "@tabler/icons-react";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./controls.css";

export type ButtonVariant = "filled" | "default" | "light" | "subtle" | "neutral" | "danger";
export type ButtonSize = "compact" | "xs" | "sm" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: Icon;
  fullWidth?: boolean;
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
