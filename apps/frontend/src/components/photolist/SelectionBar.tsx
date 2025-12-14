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
  const {
    selectMode,
    selectAllMode,
    updateSelectionState,
    selectedItems,
    idx2hash,
    photosetQuery,
    totalCount,
  } = props;
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
              if (selectAllMode) {
                // Deselect all - exit select all mode
                updateSelectionState({
                  selectMode: false,
                  selectAllMode: false,
                  selectedItems: [],
                  selectAllQuery: undefined,
                });
              } else if (selectedItems.length === idx2hash.length) {
                // All currently loaded items selected - deselect
                updateSelectionState({
                  selectMode: false,
                  selectAllMode: false,
                  selectedItems: [],
                  selectAllQuery: undefined,
                });
              } else {
                // Select all - use server-side mode
                updateSelectionState({
                  selectMode: true,
                  selectAllMode: true,
                  selectedItems: [], // Empty - server handles it, items here are exclusions
                  selectAllQuery: photosetQuery,
                  totalCount,
                });
              }
            }}
          >
            <Checks color={isAllSelected ? "green" : "gray"} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="sm">
            {isAllSelected ? t("selectionbar.deselect") : t("selectionbar.select")}
          </Text>
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
