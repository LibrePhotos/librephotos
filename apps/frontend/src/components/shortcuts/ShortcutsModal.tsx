import { Badge, Group, Kbd, Modal, Stack, Table, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { CHORD_KEY, goToShortcuts, HELP_KEY } from "./goToShortcuts";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  isAdmin: boolean;
}>;

function KeyRow({ label, keys }: Readonly<{ label: React.ReactNode; keys: React.ReactNode }>) {
  return (
    <Table.Tr>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="right">
        <Group gap={4} justify="flex-end" wrap="nowrap">
          {keys}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

/** The keyboard shortcuts that work everywhere in the app (#2037), opened with `?`. */
export function ShortcutsModal({ opened, onClose, isAdmin }: Props) {
  const { t } = useTranslation();
  const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
  return (
    <Modal opened={opened} onClose={onClose} centered title={t("shortcuts.title")} styles={modalTitleStyles}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {t("shortcuts.goto")}
        </Text>
        <Table>
          <Table.Tbody>
            {goToShortcuts(isAdmin).map(shortcut => (
              <KeyRow
                key={shortcut.key}
                label={
                  <Group gap="xs">
                    {t(shortcut.label)}
                    {shortcut.adminOnly && (
                      <Badge size="xs" variant="light" color="gray">
                        {t("shortcuts.adminsonly")}
                      </Badge>
                    )}
                  </Group>
                }
                keys={
                  <>
                    <Kbd>{CHORD_KEY}</Kbd>
                    <Text size="xs" c="dimmed">
                      {t("shortcuts.then")}
                    </Text>
                    <Kbd>{shortcut.key}</Kbd>
                  </>
                }
              />
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {t("shortcuts.everywhere")}
        </Text>
        <Table>
          <Table.Tbody>
            <KeyRow
              label={t("search.search")}
              keys={
                <>
                  <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                  <Kbd>K</Kbd>
                </>
              }
            />
            <KeyRow label={t("shortcuts.thislist")} keys={<Kbd>{HELP_KEY}</Kbd>} />
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          {t("shortcuts.note")}
        </Text>
      </Stack>
    </Modal>
  );
}
