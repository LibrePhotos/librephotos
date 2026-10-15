import { Highlight, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { VirtualList } from "../virtual/VirtualList";
import classes from "./AllMetadata.module.css";
import type { MetadataRow } from "./metadataRows";

type Props = Readonly<{
  rows: MetadataRow[];
  filter: string;
  height: number;
  onToggleGroup: (name: string) => void;
  /** The file's name, for the scroll region's accessible name. */
  fileName: string;
}>;

// What a row measures before it renders: a header, a one-line tag.
const GROUP_HEIGHT = 32;
const TAG_HEIGHT = 30;

function GroupHeader({
  row,
  filter,
  onToggle,
}: Readonly<{ row: Extract<MetadataRow, { type: "group" }>; filter: string; onToggle: (name: string) => void }>) {
  const { t } = useTranslation();
  const filtering = filter.trim() !== "";
  const Chevron = row.collapsed ? IconChevronRight : IconChevronDown;
  const content = (
    <>
      <Chevron size={14} aria-hidden />
      <Text component="span" size="sm" fw={700}>
        {row.name}
      </Text>
      <Text component="span" size="xs" c="dimmed">
        {filtering
          ? t("allmetadata.groupmatches", { shown: row.matching, count: row.total })
          : t("allmetadata.tagcount", { count: row.total })}
      </Text>
    </>
  );
  // While a filter is set every group with a match is open, so the header is only a label.
  if (filtering) return <div className={classes.groupHeader}>{content}</div>;
  return (
    <UnstyledButton className={classes.groupHeader} aria-expanded={!row.collapsed} onClick={() => onToggle(row.name)}>
      {content}
    </UnstyledButton>
  );
}

function TagRow({ row, filter }: Readonly<{ row: Extract<MetadataRow, { type: "tag" }>; filter: string }>) {
  const query = filter.trim();
  return (
    <div className={classes.tagRow}>
      <Highlight highlight={query} size="sm" c="dimmed" className={classes.tagName} title={row.fullName}>
        {row.name}
      </Highlight>
      {row.binary ? (
        <Text size="sm" fs="italic" c="dimmed" className={classes.tagValue}>
          {row.value}
        </Text>
      ) : (
        <Highlight highlight={query} size="sm" ff="monospace" className={classes.tagValue}>
          {row.value}
        </Highlight>
      )}
    </div>
  );
}

/**
 * One file's tags, grouped by ExifTool group under headers that open and close. Virtualized:
 * maker notes alone can be several hundred rows.
 */
export function MetadataTable({ rows, filter, height, onToggleGroup, fileName }: Props) {
  const { t } = useTranslation();
  const estimateSize = useCallback(
    (index: number) => (rows[index]?.type === "group" ? GROUP_HEIGHT : TAG_HEIGHT),
    [rows]
  );
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? String(index), [rows]);
  const renderItem = (index: number) => {
    const row = rows[index];
    if (row === undefined) return null;
    if (row.type === "group") return <GroupHeader row={row} filter={filter} onToggle={onToggleGroup} />;
    return <TagRow row={row} filter={filter} />;
  };
  return (
    <VirtualList
      count={rows.length}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
      height={height}
      className={classes.table}
      aria-label={t("allmetadata.tableof", { name: fileName })}
    />
  );
}
