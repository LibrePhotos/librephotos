import { ActionIcon, Button, Group, Popover, Text } from "@mantine/core";
import { IconCheck as Check, IconChecks as Checks } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  selectMode: boolean;
  updateSelectionState: (arg0: any) => void;
  selectedItems: any[];
  idx2hash: any[];
};

export function SelectionBar(props: Readonly<Props>) {
  const { t } = useTranslation();
  const { selectMode, updateSelectionState, selectedItems, idx2hash } = props;
  const [openedAll, setOpenedAll] = useState(false);
  const [openedSelect, setOpenedSelect] = useState(false);

  return (
    <Group gap="xs">
      <Popover opened={openedAll} withArrow withinPortal>
        <Popover.Target>
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
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="sm">
            {selectedItems.length === idx2hash.length ? t("selectionbar.deselect") : t("selectionbar.select")}
          </Text>
        </Popover.Dropdown>
      </Popover>
      <div style={{ paddingTop: 5 }}>
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
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm">{t("selectionbar.toggle")}</Text>
          </Popover.Dropdown>
        </Popover>
      </div>
    </Group>
  );
}
