import { ActionIcon, Button, Group, Popover, Text } from "@mantine/core";
import { IconCheck as Check, IconChecks as Checks } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BulkPhotoQuery, SelectionState } from "../../api_client/photos/types";

type Props = {
  selectMode: boolean;
  selectAllMode: boolean;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  selectedItems: any[];
  idx2hash: any[];
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
};

export function SelectionBar(props: Readonly<Props>) {
  const { t } = useTranslation();
  const { selectMode, selectAllMode, updateSelectionState, selectedItems, idx2hash, photosetQuery, totalCount } = props;
  const [openedAll, setOpenedAll] = useState(false);
  const [openedSelect, setOpenedSelect] = useState(false);

  // Calculate display count based on mode
  const getDisplayText = () => {
    if (selectAllMode) {
      const excludedCount = selectedItems.length;
      if (excludedCount > 0) {
        return `${t("selectionbar.all")} ${totalCount} (${excludedCount} ${t("selectionbar.excluded")})`;
      }
      return `${t("selectionbar.all")} ${totalCount} ${t("selectionbar.selected")}`;
    }
    return `${selectedItems.length} ${t("selectionbar.selected")}`;
  };

  // Determine if "all" are selected
  const isAllSelected = selectAllMode || selectedItems.length === idx2hash.length;

  return (
    <Group gap="xs">
      <Popover opened={openedAll} withArrow withinPortal>
        <Popover.Target>
          <ActionIcon
            onMouseEnter={() => setOpenedAll(true)}
            onMouseLeave={() => setOpenedAll(false)}
            variant="light"
            onClick={() => {
              if (selectAllMode || (idx2hash.length > 0 && selectedItems.length === idx2hash.length)) {
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
                // is already loaded, so select every loaded item client-side. Avoids the
                // empty-query fallback that would otherwise match the whole library.
                updateSelectionState({
                  selectMode: true,
                  selectAllMode: false,
                  selectedItems: idx2hash.filter(item => !item.isTemp),
                  selectAllQuery: undefined,
                });
              }
            }}
          >
            <Checks color={isAllSelected ? "green" : "gray"} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="sm">{isAllSelected ? t("selectionbar.deselect") : t("selectionbar.select")}</Text>
        </Popover.Dropdown>
      </Popover>
      <div>
        <Popover opened={openedSelect} withArrow>
          <Popover.Target>
            <Button
              onMouseEnter={() => setOpenedSelect(true)}
              onMouseLeave={() => setOpenedSelect(false)}
              variant="light"
              size="xs"
              leftSection={<Check color={selectMode ? "green" : "gray"} />}
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
