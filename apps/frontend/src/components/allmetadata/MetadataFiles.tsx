import type { RawMetadataFile } from "@librephotos/api-client";
import { Badge, Button, CloseButton, Group, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { IconCheck, IconChevronDown, IconChevronRight, IconCopy, IconSearch } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./AllMetadata.module.css";
import { allGroups, buildRows, fileAsJson, fileNameOfLabel, initiallyCollapsed, tagCount } from "./metadataRows";
import { MetadataTable } from "./MetadataTable";

type Props = Readonly<{
  files: RawMetadataFile[];
  /** Height of the tag table in px. */
  tableHeight: number;
}>;

// How long the Copy button says "Copied".
const COPIED_MS = 2000;

function FileTabLabel({ file }: Readonly<{ file: RawMetadataFile }>) {
  const { t } = useTranslation();
  const isMedia = file.kind === "media";
  return (
    <span className={classes.tabLabel}>
      <span>{fileNameOfLabel(file.path_label)}</span>
      <Badge size="xs" variant="light" color={isMedia ? "blue" : "gray"}>
        {isMedia ? t("allmetadata.media") : t("allmetadata.sidecar")}
      </Badge>
      <Text component="span" size="xs" c="dimmed">
        {tagCount(file)}
      </Text>
    </span>
  );
}

type FilePanelProps = Readonly<{
  file: RawMetadataFile;
  filter: string;
  onFilterChange: (filter: string) => void;
  tableHeight: number;
}>;

/** One file: the filter, Collapse all, Copy as JSON, the match count and the grouped tags. */
function FilePanel({ file, filter, onFilterChange, tableHeight }: FilePanelProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: COPIED_MS });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initiallyCollapsed(file));
  const table = useMemo(() => buildRows(file, filter, collapsed), [file, filter, collapsed]);
  const filtering = filter.trim() !== "";
  const everyGroupClosed = file.groups.length > 0 && collapsed.size >= file.groups.length;
  const name = fileNameOfLabel(file.path_label);

  const toggleGroup = (group: string) => {
    const next = new Set(collapsed);
    if (!next.delete(group)) next.add(group);
    setCollapsed(next);
  };

  return (
    <Stack gap="xs" pt="sm">
      <Group gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          leftSection={<IconSearch size={16} aria-hidden />}
          rightSection={
            filtering ? (
              <CloseButton size="sm" aria-label={t("allmetadata.clearfilter")} onClick={() => onFilterChange("")} />
            ) : undefined
          }
          placeholder={t("allmetadata.filter")}
          aria-label={t("allmetadata.filter")}
          value={filter}
          onChange={event => onFilterChange(event.currentTarget.value)}
        />
        {!filtering && (
          <Button
            variant="default"
            visibleFrom="xs"
            leftSection={everyGroupClosed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
            onClick={() => setCollapsed(everyGroupClosed ? new Set() : allGroups(file))}
          >
            {everyGroupClosed ? t("allmetadata.expandall") : t("allmetadata.collapseall")}
          </Button>
        )}
        <Button
          variant="default"
          leftSection={clipboard.copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          onClick={() => clipboard.copy(fileAsJson(file))}
        >
          {clipboard.copied ? t("allmetadata.copied") : t("allmetadata.copy")}
        </Button>
      </Group>
      <Text size="xs" c={clipboard.error ? "red" : "dimmed"} aria-live="polite">
        {clipboard.error && t("allmetadata.copyfailed")}
        {!clipboard.error && filtering && t("allmetadata.matches", { shown: table.matching, count: table.total })}
      </Text>
      {table.rows.length > 0 ? (
        <MetadataTable
          rows={table.rows}
          filter={filter}
          height={tableHeight}
          onToggleGroup={toggleGroup}
          fileName={name}
        />
      ) : (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          {filtering ? t("allmetadata.nomatch", { query: filter.trim(), name }) : t("allmetadata.notags")}
        </Text>
      )}
    </Stack>
  );
}

/** One tab per file (the media file, then each sidecar); the filter carries over between tabs. */
export function MetadataFiles({ files, tableHeight }: Props) {
  const [active, setActive] = useState<string>("0");
  const [filter, setFilter] = useState("");
  return (
    <Tabs value={active} onChange={value => setActive(value ?? "0")} keepMounted={false}>
      <Tabs.List className={classes.tabList}>
        {files.map((file, index) => (
          <Tabs.Tab key={file.path_label} value={String(index)} className={classes.tab}>
            <FileTabLabel file={file} />
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {files.map((file, index) => (
        <Tabs.Panel key={file.path_label} value={String(index)}>
          <FilePanel file={file} filter={filter} onFilterChange={setFilter} tableHeight={tableHeight} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
