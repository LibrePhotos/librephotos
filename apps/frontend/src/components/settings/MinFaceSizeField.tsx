import { Box, Flex, Group, Radio, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatPercent } from "../../util/formatCount";
import { FaceSizeIllustration } from "./FaceSizeIllustration";
import classes from "./MinFaceSizeField.module.css";

/** The choices of #2749: Off, then 2, 4 and 8 % of the photo's shorter side. */
const MIN_FACE_SIZES = [0.02, 0.04, 0.08] as const;

/** The caption's example photo is 1080 px tall. */
const EXAMPLE_HEIGHT = 1080;

type Props = Readonly<{
  /** The saved share of the shorter side; 0 is off. */
  value: number;
  onChange: (minFaceSize: number) => void;
}>;

/**
 * Face options: the minimum size of a detected face worth saving (#2749), with a drawing of a
 * photo that marks the faces a choice skips. It applies to new scans only.
 */
export function MinFaceSizeField({ value, onChange }: Props) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const caption =
    value > 0
      ? t("settings.min_face_size_caption", {
          percent: formatPercent(value, locale, 0),
          pixels: Math.round(value * EXAMPLE_HEIGHT),
        })
      : t("settings.min_face_size_off_caption");

  return (
    <Flex direction={{ base: "column", sm: "row" }} gap="md" align="flex-start">
      <Stack gap="xs" flex={1}>
        <Radio.Group
          label={t("settings.min_face_size")}
          description={t("settings.min_face_size_help")}
          // Off is 0, a real choice here: not choiceOf, which reads 0 as unset.
          value={value.toString()}
          onChange={choice => onChange(parseFloat(choice) || 0)}
        >
          <Group mt="xs">
            <Radio value="0" label={t("settings.size.off")} />
            {MIN_FACE_SIZES.map(size => (
              <Radio key={size} value={size.toString()} label={formatPercent(size, locale, 0)} />
            ))}
          </Group>
        </Radio.Group>
        <Text size="sm" aria-live="polite">
          {caption}
        </Text>
      </Stack>
      <Stack gap={4} className={classes.illustration}>
        <FaceSizeIllustration minFaceSize={value} label={t("settings.min_face_size_example")} />
        <Group gap="md">
          <Group gap={6}>
            <Box component="span" className={classes.swatch} />
            <Text size="xs" c="dimmed">
              {t("settings.min_face_size_kept")}
            </Text>
          </Group>
          <Group gap={6}>
            <Box component="span" className={`${classes.swatch} ${classes.swatchSkipped}`} />
            <Text size="xs" c="dimmed">
              {t("settings.min_face_size_skipped")}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Flex>
  );
}
