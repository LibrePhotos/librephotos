import { Image, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { ValueSlider } from "../controls/ValueSlider";
import { useEditor } from "../EditorContext";
import { appliedFilter, blendFilter, EDIT_FILTERS, filterStrength, ORIGINAL_FILTER, type FilterId } from "./filters";
import classes from "./FiltersPanel.module.css";
import { useFilterThumbnails } from "./useFilterThumbnails";

const STRENGTH = { min: 0, max: 100, origin: 100, step: 1, decimals: 0, bipolar: false } as const;

/**
 * The Filters tab: Original and the built-in looks, each as a small picture of this photo with it,
 * and the strength of the look applied. Picking a look is one step; it replaces the look before it
 * instead of adding to it.
 */
export function FiltersPanel() {
  const { t } = useTranslation();
  const { session, commands, source, ready } = useEditor();
  const { id: activeId, base } = appliedFilter(session.history, session.cursor, session.committed);
  const thumbnails = useFilterThumbnails(source, base, ready);
  const active = EDIT_FILTERS.find(filter => filter.id === activeId);
  const showsOriginal = activeId === null && session.history[session.cursor]?.value === ORIGINAL_FILTER;

  const choose = (id: FilterId | typeof ORIGINAL_FILTER) => {
    const filter = EDIT_FILTERS.find(candidate => candidate.id === id);
    commands.apply("preset", filter ? blendFilter(base, filter.values, 1) : base, id);
  };
  const tile = (id: FilterId | typeof ORIGINAL_FILTER, label: string, selected: boolean) => (
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
      {active && (
        <ValueSlider
          label={t("editor.filters.strength")}
          spec={STRENGTH}
          unit="%"
          value={Math.round(filterStrength(base, active.values, session.recipe) * 100)}
          onLive={value => commands.liveApply("preset", blendFilter(base, active.values, value / 100), active.id)}
          onCommit={commands.commit}
          onSet={value => commands.apply("preset", blendFilter(base, active.values, value / 100), active.id)}
          onReset={() => commands.apply("preset", blendFilter(base, active.values, 1), active.id)}
        />
      )}
    </Stack>
  );
}
