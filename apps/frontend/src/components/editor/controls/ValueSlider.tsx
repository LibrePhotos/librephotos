import { Group, Slider, Text, TextInput, UnstyledButton } from "@mantine/core";
import React, { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatValue, parseValue, type SliderSpec } from "./sliderSpec";
import classes from "./ValueSlider.module.css";

export type ValueSliderProps = Readonly<{
  label: string;
  spec: SliderSpec;
  value: number;
  /** The value while the user drags (or presses an arrow key): shown at once. */
  onLive: (value: number) => void;
  /** The drag or key press ended: the change becomes one step. */
  onCommit: () => void;
  /** A value typed into the number field: one step. */
  onSet: (value: number) => void;
  /** Back to the default: a double click on the label or the handle. One step. */
  onReset: () => void;
  /**
   * The double click's first click may have moved the handle (a press jumps it to the pointer):
   * called before onReset, so that move can be taken back first.
   */
  onPressStart?: () => void;
  /** Shown after the value, e.g. "%" for a strength. */
  unit?: string;
}>;

/**
 * One slider of the editor: its label (double click resets), the value as an editable number, and
 * the track with a mark at the default; a bipolar control fills from zero. A drag is live while it
 * lasts and one step when it ends; an arrow key is one step.
 */
export function ValueSlider({
  label,
  spec,
  value,
  onLive,
  onCommit,
  onSet,
  onReset,
  onPressStart,
  unit,
}: ValueSliderProps) {
  const { t } = useTranslation();
  const inputId = useId();
  return (
    <div className={classes.root}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <UnstyledButton
          className={classes.label}
          onDoubleClick={onReset}
          // A button, so the keyboard can reset too: Enter or Space on the label.
          onClick={event => {
            if (event.detail === 0) onReset();
          }}
          aria-label={t("editor.slider.reset", { control: label })}
        >
          <Text size="sm" component="span">
            {label}
          </Text>
        </UnstyledButton>
        <Group gap={2} wrap="nowrap">
          <ValueField id={inputId} label={label} spec={spec} value={value} onSet={onSet} />
          {unit && (
            <Text size="xs" c="dimmed" component="span" aria-hidden>
              {unit}
            </Text>
          )}
        </Group>
      </Group>
      <Slider
        className={classes.slider}
        size="sm"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        precision={spec.decimals}
        value={value}
        onChange={onLive}
        // Mantine applies a move on the next animation frame and may end the drag before it: the
        // step is recorded a frame later, after the last move.
        onChangeEnd={() => requestAnimationFrame(() => onCommit())}
        startPointValue={spec.bipolar ? 0 : undefined}
        marks={[{ value: spec.origin }]}
        label={null}
        thumbLabel={label}
        onMouseDownCapture={event => {
          if (event.detail === 1) onPressStart?.();
        }}
        onDoubleClick={onReset}
      />
    </div>
  );
}

type ValueFieldProps = Readonly<{
  id: string;
  label: string;
  spec: SliderSpec;
  value: number;
  onSet: (value: number) => void;
}>;

/** The value as text: typed into, it sets the control on Enter or when the field loses focus. */
function ValueField({ id, label, spec, value, onSet }: ValueFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const escaped = useRef(false);
  const shown = formatValue(spec, value);
  const finish = () => {
    if (draft !== null && !escaped.current) {
      const parsed = parseValue(spec, draft);
      if (parsed !== null && parsed !== value) onSet(parsed);
    }
    escaped.current = false;
    setDraft(null);
  };
  return (
    <TextInput
      id={id}
      size="xs"
      variant="unstyled"
      classNames={{ input: classes.value }}
      aria-label={label}
      inputMode="decimal"
      value={draft ?? shown}
      onFocus={event => {
        setDraft(shown);
        event.currentTarget.select();
      }}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          // Leaves the field without a change; the editor's own Escape does not close it.
          escaped.current = true;
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
