import type { MoveClash, MoveOnConflict } from "@librephotos/api-client";
import { Button, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The photos whose name is taken in the folder, from the move's preview. */
  clashes: readonly MoveClash[];
  folderName: string;
  onChoose: (choice: MoveOnConflict) => void;
  /** The move is running: the buttons wait. */
  moving: boolean;
}>;

// The names listed; the rest are counted.
const LISTED = 8;

/** The names taken in the folder and the ones "Rename" gives them, the first few. */
function ClashTable({ clashes }: Readonly<{ clashes: readonly MoveClash[] }>) {
  const { t } = useTranslation();
  const more = clashes.length - LISTED;
  return (
    <>
      <Table withTableBorder fz="sm" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("movephotos.clashname")}</Table.Th>
            <Table.Th aria-label={t("movephotos.becomes")} w={24} />
            <Table.Th>{t("movephotos.clashrenamed")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {clashes.slice(0, LISTED).map(clash => (
            <Table.Tr key={clash.photo_id}>
              <Table.Td>{clash.name}</Table.Td>
              <Table.Td>
                <IconArrowRight size={14} aria-hidden />
              </Table.Td>
              <Table.Td>{clash.renamed_to ?? t("movephotos.nofreename")}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {more > 0 && (
        <Text size="xs" c="dimmed">
          {t("movephotos.moreclashes", { count: more })}
        </Text>
      )}
    </>
  );
}

/**
 * The second step of "Move to folder…" (#352): some names are taken in the folder. Rename keeps
 * both (the moved photo's files get a free name, `IMG_1 (1).jpg`), Skip leaves those photos where
 * they are. Nothing in the folder is ever overwritten.
 */
export function MoveConflictModal({ opened, onClose, clashes, folderName, onChoose, moving }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("movephotos.conflicttitle", { count: clashes.length, folder: folderName })}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm">{t("movephotos.conflictintro", { count: clashes.length })}</Text>
        <ClashTable clashes={clashes} />
        <Stack gap={4}>
          <Text size="sm">{t("movephotos.renamehint")}</Text>
          <Text size="sm">{t("movephotos.skiphint", { count: clashes.length })}</Text>
        </Stack>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="light" onClick={() => onChoose("skip")} loading={moving}>
            {t("movephotos.skip", { count: clashes.length })}
          </Button>
          <Button onClick={() => onChoose("rename")} loading={moving}>
            {t("movephotos.rename")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
