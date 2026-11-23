import { CloseButton, TextInput, type TextInputProps } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./NativeDateInput.module.css";

type NativeKind = "date" | "time" | "datetime-local";

export type NativeDateInputProps = Omit<
  TextInputProps,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "rightSection"
> &
  Readonly<{
    value?: string;
    onChange: (value: string) => void;
    min?: string;
    max?: string;
    clearable?: boolean;
  }>;

function NativeInput({
  kind,
  step,
  value = "",
  onChange,
  clearable = false,
  classNames,
  ...rest
}: NativeDateInputProps & Readonly<{ kind: NativeKind; step?: number }>) {
  const { t } = useTranslation();
  return (
    <TextInput
      {...rest}
      type={kind}
      step={step}
      value={value}
      onChange={event => onChange(event.currentTarget.value)}
      classNames={{ ...classNames, input: classes.input }}
      rightSection={
        clearable && value ? <CloseButton size="sm" aria-label={t("clear")} onClick={() => onChange("")} /> : undefined
      }
    />
  );
}

export function NativeDateInput(props: NativeDateInputProps) {
  return <NativeInput kind="date" {...props} />;
}

export function NativeTimeInput({ withSeconds = false, ...props }: NativeDateInputProps & { withSeconds?: boolean }) {
  return <NativeInput kind="time" step={withSeconds ? 1 : undefined} {...props} />;
}

export function NativeDateTimeInput({
  withSeconds = false,
  ...props
}: NativeDateInputProps & { withSeconds?: boolean }) {
  return <NativeInput kind="datetime-local" step={withSeconds ? 1 : undefined} {...props} />;
}
