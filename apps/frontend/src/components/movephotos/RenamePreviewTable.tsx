import type { RenameRow } from "@librephotos/api-client";
import { Badge, Group, Table, Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { MediaThumbnail } from "../common/MediaThumbnail";
import classes from "./RenamePreviewTable.module.css";

type Props = Readonly<{
  rows: readonly RenameRow[];
  /** All photos of the selection: more than the rows means the rest are only counted. */
  total: number;
}>;

/** What a photo that keeps its name says instead of a new one. */
function KeptName({ row }: Readonly<{ row: RenameRow }>) {
  const { t } = useTranslation();
  switch (row.status) {
    case "undated":
      return (
        <Text size="sm" c="orange">
          {t("renamephotos.undatedrow")}
        </Text>
      );
    case "refused":
      return (
        <Text size="sm" c="orange">
          {row.reason ? t(`renamephotos.refusedrow.${row.reason}`) : t("renamephotos.unchangedrow")}
        </Text>
      );
    case "no_free_name":
      return (
        <Text size="sm" c="orange">
          {t("renamephotos.nofreenamerow")}
        </Text>
      );
    case "unchanged":
    case "rename":
      return (
        <Text size="sm" c="dimmed">
          {t("renamephotos.unchangedrow")}
        </Text>
      );
  }
}

/** The new name, and what comes with it: more files renamed along, a number for a taken name. */
function NewName({ row }: Readonly<{ row: RenameRow }>) {
  const { t } = useTranslation();
  if (row.status !== "rename" || row.new_name === null) return <KeptName row={row} />;
  return (
    <Group gap={6} wrap="wrap">
      <Text size="sm" ff="monospace" c={row.number > 0 ? "orange" : "teal"} className={classes.newName}>
        {row.new_name}
      </Text>
      {row.number > 0 && (
        <Badge size="xs" color="orange" variant="light">
          {t("renamephotos.nametaken")}
        </Badge>
      )}
    </Group>
  );
}

/**
 * The first photos of a rename one by one (#2773): a thumbnail, the name now, the name it gets, and
 * why a photo keeps its name. The arrow column is named "becomes" for screen readers.
 */
export function RenamePreviewTable({ rows, total }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <>
      <div className={classes.scroller}>
        <Table withTableBorder fz="sm" verticalSpacing={4} layout="fixed">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40} aria-hidden />
              <Table.Th>{t("renamephotos.now")}</Table.Th>
              <Table.Th aria-label={t("movephotos.becomes")} w={28} />
              <Table.Th>{t("renamephotos.newname")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(row => (
              <Table.Tr key={row.photo_id}>
                <Table.Td>
                  <MediaThumbnail imageHash={row.image_hash} size={28} />
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" ff="monospace" className={classes.name}>
                      {row.name}
                    </Text>
                    {row.other_files > 0 && (
                      <Badge size="xs" variant="default">
                        {t("renamephotos.otherfiles", { count: row.other_files })}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <IconArrowRight size={14} aria-hidden />
                </Table.Td>
                <Table.Td>
                  <NewName row={row} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      {total > rows.length && (
        <Text size="xs" c="dimmed">
          {t("renamephotos.firstshown", { count: rows.length })}
        </Text>
      )}
    </>
  );
}
