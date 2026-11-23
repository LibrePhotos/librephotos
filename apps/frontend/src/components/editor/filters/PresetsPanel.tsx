import { Image, Stack, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSectionOpen } from "../controls/sectionOpen";
import { ValueSlider } from "../controls/ValueSlider";
import { useEditor } from "../EditorContext";
import { EDIT_FILTERS, ORIGINAL_FILTER } from "./filters";
import classes from "./PresetsPanel.module.css";
import { STRENGTH_SPEC, useFilterChoice, type FilterChoice } from "./useFilterChoice";
import { useFilterThumbnails } from "./useFilterThumbnails";

/**
 * The advanced mode's Presets section: the Filters tab's looks as a compact list (a small picture
 * and the name), and the strength of the applied one. The pictures are drawn while it is open.
 */
export function PresetsPanel() {
  const { t } = useTranslation();
  const { source, ready } = useEditor();
  const open = useSectionOpen();
  const { base, activeId, showsOriginal, choose, strength } = useFilterChoice();
  const thumbnails = useFilterThumbnails(source, base, ready && open);

  const row = (id: FilterChoice, label: string, selected: boolean) => (
    <UnstyledButton key={id} className={classes.row} aria-pressed={selected} onClick={() => choose(id)}>
      <span className={classes.picture}>
        {thumbnails.get(id) !== undefined && <Image src={thumbnails.get(id)} alt="" className={classes.image} />}
      </span>
      <Text size="sm" component="span" className={classes.name}>
        {label}
      </Text>
    </UnstyledButton>
  );

  return (
    <Stack gap="xs">
      <div className={classes.list} role="group" aria-label={t("editor.presets.list")}>
        {row(ORIGINAL_FILTER, t("editor.filters.original"), showsOriginal)}
        {EDIT_FILTERS.map(filter => row(filter.id, t(`editor.filters.${filter.id}`), filter.id === activeId))}
      </div>
      {strength && <ValueSlider label={t("editor.filters.strength")} spec={STRENGTH_SPEC} unit="%" {...strength} />}
    </Stack>
  );
}
