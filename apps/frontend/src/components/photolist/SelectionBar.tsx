import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { Button, Group, Text } from "@mantine/core";
import { IconChecks as Checks } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { pickedPhotos, selectedOf } from "./photoListSelection";
import type { ListSelection, SelectionEvent } from "./photoListSelection";
import classes from "./SelectionBar.module.css";
import { selectionLabel } from "./selectionLabel";

type Props = {
  selection: ListSelection;
  dispatch: (event: SelectionEvent) => void;
  idx2hash: PigPhoto[];
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
};

export function SelectionBar(props: Readonly<Props>) {
  const { t } = useTranslation();
  const { selection, dispatch, idx2hash, photosetQuery, totalCount } = props;
  const selected = selectedOf(selection, totalCount);
  const picked = pickedPhotos(selected).length;

  // Without a server-side query, select all can only take the loaded photos. On a page that
  // still shows placeholders, say so instead of claiming the whole set (#2227).
  const selectsLoadedOnly = !photosetQuery && idx2hash.some(item => item.isTemp);

  // "5 selected", "All 120 selected", "All 120 selected (3 excluded)", or "5 of 120 selected"
  // while placeholders keep select all to the loaded photos
  const displayText =
    selected.kind === "some" && selectsLoadedOnly && picked > 0
      ? t("selectionbar.selectedoftotal", { selected: picked, total: totalCount })
      : selectionLabel(t, selected);

  // An empty grid is not "all selected" (0 === 0)
  const isAllSelected = selected.kind === "all" || (idx2hash.length > 0 && picked === idx2hash.length);
  const selectAllLabel = selectsLoadedOnly ? t("selectionbar.selectloaded") : t("selectionbar.select");

  const selectAll = () => {
    if (isAllSelected) {
      dispatch({ type: "deselectAll" });
    } else if (photosetQuery) {
      // The surface pages its photos in lazily (the timeline, a person): select all by its query
      dispatch({ type: "selectAll", query: photosetQuery });
    } else {
      // No server-side query (thing/place/user albums, search): the set is normally loaded whole,
      // so every loaded photo is picked. Placeholders are left out; the count then reads "N of M".
      dispatch({ type: "selectLoaded", items: idx2hash });
    }
  };
  const selectAllText = isAllSelected ? t("selectionbar.deselect") : selectAllLabel;

  // "3 selected", then "Select all" as words (Google Photos): a bare double check said nothing.
  // The count is announced as it changes.
  return (
    <Group gap="xs" wrap="nowrap" className={classes.root}>
      <Text fw={600} px={4} aria-live="polite" className={classes.count}>
        {displayText}
      </Text>
      <Button
        variant="subtle"
        h={TOOLBAR_CONTROL_HEIGHT}
        px="xs"
        aria-label={selectAllText}
        leftSection={<Checks size={ICON_SIZE.inline} />}
        className={classes.selectAll}
        onClick={selectAll}
      >
        {selectAllText}
      </Button>
    </Group>
  );
}
