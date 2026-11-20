import type { ReactNode } from "react";
import "./controls.css";

type ToggleProps = {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  testId?: string;
};

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

export function SegmentedControl<T extends string>({
  value,
  onChange,
  data,
  label,
}: {
  value: T;
  onChange(value: T): void;
  data: Segment<T>[];
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
