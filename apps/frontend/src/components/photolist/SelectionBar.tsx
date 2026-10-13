import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Button, Group, Popover, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck as Check, IconChecks as Checks } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { SelectionState } from "../../api_client/photos/types";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";

type Props = {
  selectMode: boolean;
  selectAllMode: boolean;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  selectedItems: PigPhoto[];
  idx2hash: PigPhoto[];
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
};

export function SelectionBar(props: Readonly<Props>) {
  const { t } = useTranslation();
  const { selectMode, selectAllMode, updateSelectionState, selectedItems, idx2hash, photosetQuery, totalCount } = props;
  const [openedAll, { open: openAll, close: closeAll }] = useDisclosure(false);
  const [openedSelect, { open: openSelect, close: closeSelect }] = useDisclosure(false);

  // Without a server-side query, select all can only take the loaded photos. On a page that
  // still shows placeholders, say so instead of claiming the whole set (#2227).
  const selectsLoadedOnly = !photosetQuery && idx2hash.some(item => item.isTemp);

  // Calculate display count based on mode
  const getDisplayText = () => {
    if (selectAllMode) {
      const excludedCount = selectedItems.length;
      if (excludedCount > 0) {
        return `${t("selectionbar.all")} ${totalCount} (${excludedCount} ${t("selectionbar.excluded")})`;
      }
      return `${t("selectionbar.all")} ${totalCount} ${t("selectionbar.selected")}`;
    }
    if (selectsLoadedOnly && selectedItems.length > 0) {
      return t("selectionbar.selectedoftotal", { selected: selectedItems.length, total: totalCount });
    }
    return `${selectedItems.length} ${t("selectionbar.selected")}`;
  };

  // Determine if "all" are selected; an empty grid is not "all selected" (0 === 0)
  const isAllSelected = selectAllMode || (idx2hash.length > 0 && selectedItems.length === idx2hash.length);
  const selectAllLabel = selectsLoadedOnly ? t("selectionbar.selectloaded") : t("selectionbar.select");

  return (
    <Group gap="xs">
      <Popover opened={openedAll} withArrow withinPortal>
        <Popover.Target>
          <ActionIcon
            onMouseEnter={() => openAll()}
            onMouseLeave={() => closeAll()}
            variant="light"
            size={TOOLBAR_ACTION_SIZE}
            aria-label={isAllSelected ? t("selectionbar.deselect") : selectAllLabel}
            onClick={() => {
              if (isAllSelected) {
                // Already fully selected (server-side or every loaded item) - deselect
                updateSelectionState({
                  selectMode: false,
                  selectAllMode: false,
                  selectedItems: [],
                  selectAllQuery: undefined,
                });
              } else if (photosetQuery) {
                // Surface supplies a server-side query (it may lazily page in items
                // beyond those loaded, e.g. the timeline / person albums). Select all
                // via the query; selectedItems here tracks exclusions.
                updateSelectionState({
                  selectMode: true,
                  selectAllMode: true,
                  selectedItems: [],
                  selectAllQuery: photosetQuery,
                  totalCount,
                });
              } else {
                // No server-side query (thing/place/user albums, search): the full set
                // is normally already loaded, so select every loaded item client-side.
                // Avoids the empty-query fallback that would otherwise match the whole
                // library. Placeholders are left out; the count then reads "N of M".
                updateSelectionState({
                  selectMode: true,
                  selectAllMode: false,
                  selectedItems: idx2hash.filter(item => !item.isTemp),
                  selectAllQuery: undefined,
                });
              }
            }}
          >
            <Checks size={ICON_SIZE.toolbar} color={isAllSelected ? "green" : "gray"} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="sm">{isAllSelected ? t("selectionbar.deselect") : selectAllLabel}</Text>
        </Popover.Dropdown>
      </Popover>
      <div>
        <Popover opened={openedSelect} withArrow>
          <Popover.Target>
            <Button
              onMouseEnter={() => openSelect()}
              onMouseLeave={() => closeSelect()}
              variant="light"
              size="xs"
              h={TOOLBAR_CONTROL_HEIGHT}
              leftSection={<Check size={ICON_SIZE.toolbar} color={selectMode ? "green" : "gray"} />}
              color={selectMode ? "blue" : "gray"}
              onClick={() => {
                if (selectMode) {
                  // Exit selection mode
                  updateSelectionState({
                    selectMode: false,
                    selectAllMode: false,
                    selectedItems: [],
                    selectAllQuery: undefined,
                  });
                } else {
                  // Enter selection mode
                  updateSelectionState({
                    selectMode: true,
                  });
                }
              }}
            >
              {getDisplayText()}
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm">{t("selectionbar.toggle")}</Text>
          </Popover.Dropdown>
        </Popover>
      </div>
    </Group>
  );
}
