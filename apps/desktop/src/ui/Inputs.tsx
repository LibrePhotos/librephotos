import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import "./controls.css";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
};

function Field({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field" data-error={error ? "" : undefined}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {description && (
        <div className="field-description" id={`${id}-description`}>
          {description}
        </div>
      )}
      <div className="field-control">{children}</div>
      {error && (
        <div className="field-error" id={`${id}-error`}>
          {error}
        </div>
      )}
    </div>
  );
}

function describedBy(id: string, description: ReactNode, error: ReactNode): string | undefined {
  const ids = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function TextInput({ label, description, error, id: given, className, ...input }: FieldProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Field id={id} label={label} description={description} error={error}>
      <input
        id={id}
        className={`field-input${className ? ` ${className}` : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        {...input}
      />
    </Field>
  );
}

export function PasswordInput({ label, description, error, id: given, className, ...input }: Omit<FieldProps, "type">) {
  const auto = useId();
  const id = given ?? auto;
  const [visible, setVisible] = useState(false);
  const Eye = visible ? IconEyeOff : IconEye;
  return (
    <Field id={id} label={label} description={description} error={error}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        className={`field-input with-right${className ? ` ${className}` : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        {...input}
      />
      <button
        type="button"
        className="field-right"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible(v => !v)}
      >
        <Eye size={16} stroke={1.75} aria-hidden="true" />
      </button>
    </Field>
  );
}
