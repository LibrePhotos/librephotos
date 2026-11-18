import type { ReactNode } from "react";
import "./controls.css";

type ToggleProps = {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  /** A dimmed line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  testId?: string;
};

/** Mantine's Switch (md) in the web theme: a visible off track and a plain white thumb. */
export function Switch({ checked, onChange, label, description, disabled, testId }: ToggleProps) {
  return (
    <label className="switch" data-disabled={disabled ? "" : undefined}>
      <input
        type="checkbox"
        role="switch"
        className="switch-input"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-text">
        <span>{label}</span>
        {description && <span className="switch-description">{description}</span>}
      </span>
    </label>
  );
}

/** Mantine's Checkbox: a 20px box with a 1.5px ring, filled with the primary colour when checked. */
export function Checkbox({ checked, onChange, label, description, disabled, testId }: ToggleProps) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        className="lp-checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="checkbox-text">
        <span>{label}</span>
        {description && <span className="switch-description">{description}</span>}
      </span>
    </label>
  );
}

export type Segment<T extends string> = { value: T; label: ReactNode; count?: number };

/** The web's Segmented capsule (a SegmentedControl): a grey pill track, the current segment raised. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  data,
  label,
}: {
  value: T;
  onChange(value: T): void;
  data: Segment<T>[];
  /** Accessible name of the group. */
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {data.map(s => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={s.value === value}
          className="segmented-item"
          onClick={() => onChange(s.value)}
        >
          <span>{s.label}</span>
          {s.count !== undefined && <span className="segmented-count">{s.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}
