import { Image, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { ValueSlider } from "../controls/ValueSlider";
import { useEditor } from "../EditorContext";
import { EDIT_FILTERS, ORIGINAL_FILTER } from "./filters";
import classes from "./FiltersPanel.module.css";
import { STRENGTH_SPEC, useFilterChoice, type FilterChoice } from "./useFilterChoice";
import { useFilterThumbnails } from "./useFilterThumbnails";

/**
 * The Filters tab: Original and the built-in looks, each as a small picture of this photo with it,
 * and the strength of the look applied. Picking a look is one step; it replaces the look before it
 * instead of adding to it.
 */
export function FiltersPanel() {
  const { t } = useTranslation();
  const { source, ready } = useEditor();
  const { base, activeId, showsOriginal, choose, strength } = useFilterChoice();
  const thumbnails = useFilterThumbnails(source, base, ready);

  const tile = (id: FilterChoice, label: string, selected: boolean) => (
    <UnstyledButton key={id} className={classes.tile} aria-pressed={selected} onClick={() => choose(id)}>
      <div className={classes.picture}>
        {thumbnails.get(id) !== undefined && <Image src={thumbnails.get(id)} alt="" className={classes.image} />}
      </div>
      <Text size="xs" ta="center" className={classes.name}>
        {label}
      </Text>
    </UnstyledButton>
  );

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 4, xs: 3 }} spacing={8} verticalSpacing={10} className={classes.grid}>
        {tile(ORIGINAL_FILTER, t("editor.filters.original"), showsOriginal)}
        {EDIT_FILTERS.map(filter => tile(filter.id, t(`editor.filters.${filter.id}`), filter.id === activeId))}
      </SimpleGrid>
      {strength && <ValueSlider label={t("editor.filters.strength")} spec={STRENGTH_SPEC} unit="%" {...strength} />}
    </Stack>
  );
}
