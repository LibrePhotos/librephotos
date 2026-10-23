import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  DATE_TOKENS,
  insertToken,
  NAME_PRESETS,
  NAME_TOKEN,
  NAMED_PRESETS,
  presetOf,
  type NamePreset,
} from "./namePatterns";
import classes from "./RenamePatternField.module.css";
import type { RenamePhotosValues } from "./RenamePhotosModal.schema";

type Props = Readonly<{ form: UseFormReturnType<RenamePhotosValues> }>;

const TOKENS = [...DATE_TOKENS, NAME_TOKEN];

/**
 * The name of "Rename files…": a preset, the pattern itself, and buttons that put a token where the
 * caret is. Typing in the field makes the preset "Custom".
 */
export function RenamePatternField({ form }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const pattern = form.getValues().pattern;
  const presets = [
    ...NAMED_PRESETS.map(value => ({ value, label: t(`renamephotos.presets.${value}`) })),
    { value: "custom", label: t("renamephotos.presets.custom") },
  ];

  const choosePreset = (value: string | null) => {
    const preset = NAMED_PRESETS.find(candidate => candidate === value);
    if (preset) form.setFieldValue("pattern", NAME_PRESETS[preset]);
  };
  const insert = (token: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? pattern.length;
    const [next, caret] = insertToken(pattern, token, start, element?.selectionEnd ?? start);
    form.setFieldValue("pattern", next);
    // The field keeps the focus, with the caret after the token.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };

  return (
    <Stack gap={6}>
      <Group gap="xs" align="flex-start" wrap="wrap">
        <Select
          aria-label={t("renamephotos.preset")}
          data={presets}
          value={presetOf(pattern) satisfies NamePreset}
          onChange={choosePreset}
          allowDeselect={false}
          w={{ base: "100%", xs: 200 }}
        />
        <TextInput
          ref={input}
          aria-label={t("renamephotos.pattern")}
          classNames={{ input: classes.mono }}
          flex={1}
          miw={220}
          spellCheck={false}
          autoComplete="off"
          {...form.getInputProps("pattern")}
        />
      </Group>
      <Group gap={6} wrap="wrap">
        <Text size="xs" c="dimmed">
          {t("renamephotos.tokens")}
        </Text>
        {TOKENS.map(token => (
          <Button
            key={token}
            size="compact-xs"
            variant="light"
            radius="xl"
            ff="monospace"
            aria-label={t("renamephotos.inserttoken", { token })}
            // Keep the focus (and the caret) in the field.
            onMouseDown={event => event.preventDefault()}
            onClick={() => insert(token)}
          >
            {token}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
