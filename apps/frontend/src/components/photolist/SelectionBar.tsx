import { ActionIcon, Button, Group, Popover, Text } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Checks } from "tabler-icons-react";

type Props = {
  selectMode: boolean;
  updateSelectionState: (any) => void;
  selectedItems: any[];
  idx2hash: any[];
};

export const SelectionBar = (props: Props) => {
  const [openedAll, setOpenedAll] = useState(false);
  const [openedSelect, setOpenedSelect] = useState(false);

  const { t } = useTranslation();

  const { selectMode, updateSelectionState, selectedItems, idx2hash } = props;
  return (
    <Group spacing="xs">
      <Popover
        opened={openedAll}
        onClose={() => setOpenedAll(false)}
        withArrow
        target={
          <ActionIcon
            onMouseEnter={() => setOpenedAll(true)}
            onMouseLeave={() => setOpenedAll(false)}
            variant="light"
            onClick={() => {
              if (selectedItems.length === idx2hash.length) {
                updateSelectionState({
                  selectMode: false,
                  selectedItems: [],
                });
              } else {
                updateSelectionState({
                  selectMode: true,
                  selectedItems: idx2hash,
                });
              }
            }}
          >
            <Checks color={selectedItems.length === idx2hash.length ? "green" : "gray"} />
          </ActionIcon>
        }
      >
        <Text size="sm">
          {selectedItems.length === idx2hash.length ? t("selectionbar.deselect") : t("selectionbar.select")}
        </Text>
      </Popover>
      <div style={{ paddingTop: 5 }}>
        <Popover
          opened={openedSelect}
          onClose={() => setOpenedSelect(false)}
          withArrow
          target={
            <Button
              onMouseEnter={() => setOpenedSelect(true)}
              onMouseLeave={() => setOpenedSelect(false)}
              variant="light"
              size="xs"
              leftIcon={<Check color={selectMode ? "green" : "gray"} />}
              color={selectMode ? "blue" : "gray"}
              onClick={() => {
                updateSelectionState({
                  selectMode: !selectMode,
                });
                if (selectMode) {
                  updateSelectionState({
                    selectMode: false,
                    selectedItems: [] as any[],
                  });
                }
              }}
            >
              {`${selectedItems.length} ${t("selectionbar.selected")}`}
            </Button>
          }
        >
          <Text size="sm">{t("selectionbar.toggle")}</Text>
        </Popover>
      </div>
    </Group>
  );
};
