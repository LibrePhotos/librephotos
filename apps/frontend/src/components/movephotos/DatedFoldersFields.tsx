import { Box, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { childPath } from "../../util/folderPaths";
import classes from "./MovePhotosModal.module.css";
import type { MovePhotosValues } from "./MovePhotosModal.schema";
import { FOLDER_PRESETS } from "./namePatterns";

type Props = Readonly<{
  form: UseFormReturnType<MovePhotosValues>;
  /** The destination, once it is a valid folder. */
  target: string | null;
  /** The first folder the preview found, to show a real example; null before the preview. */
  firstFolder: string | null;
}>;

/** The folders below the destination: the first one the preview found, or the pattern itself. */
function examplePart(target: string, firstFolder: string | null, pattern: string): string {
  if (firstFolder !== null && firstFolder.length > target.length) {
    return firstFolder.slice(target.length).replace(/^[\\/]+/, "");
  }
  return pattern;
}

/**
 * "Sort into folders by date" (#2774): each photo goes into the folder of its capture date inside
 * the destination. Three presets, and an example path with the date folders set apart in colour
 * (and in bold, for those who do not see the colour).
 */
export function DatedFoldersFields({ form, target, firstFolder }: Props) {
  const { t } = useTranslation();
  const { byDate, folderPattern } = form.getValues();
  return (
    <Stack gap={6}>
      <Switch
        label={t("movephotos.bydate")}
        description={t("movephotos.bydatehint")}
        {...form.getInputProps("byDate", { type: "checkbox" })}
      />
      {byDate && (
        <>
          <SegmentedControl
            aria-label={t("movephotos.bydatepattern")}
            data={[...FOLDER_PRESETS]}
            value={folderPattern}
            onChange={value => form.setFieldValue("folderPattern", value)}
            size="xs"
            className={classes.presets}
          />
          {target !== null && (
            <Text size="xs" c="dimmed" ff="monospace" className={classes.example}>
              {t("movephotos.example")} {childPath(target, "")}
              <Box component="strong" c="blue">
                {examplePart(target, firstFolder, folderPattern)}
              </Box>
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
