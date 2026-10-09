import {
  ActionIcon,
  Box,
  Button,
  Card,
  Flex,
  Loader,
  NumberInput,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchClient } from "../../api_client/api";
import { useFetchServerLogsViewQuery } from "../../api_client/server/hooks";

function downloadLogsBlob(data: unknown) {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === "string") {
    blob = new Blob([data], { type: "text/plain" });
  } else {
    return;
  }
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "librephotos.log";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

const DEFAULT_LINES = 100;

export function ServerLogsCard() {
  const { t } = useTranslation();
  // The field may be empty while typing; query with the debounced value, so that typing "500"
  // does not fetch 5, then 50, then 500 lines, and an empty field does not snap back to 100.
  const [linesInput, setLinesInput] = useState<string | number>(DEFAULT_LINES);
  const [debouncedLines] = useDebouncedValue(linesInput, 400);
  const lines = Number(debouncedLines) || DEFAULT_LINES;
  const { data, isFetching, refetch, dataUpdatedAt } = useFetchServerLogsViewQuery(lines);
  const [isDownloading, setIsDownloading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  // The newest line is the last one: open the panel there, also after a Refresh.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight });
    }
  }, [dataUpdatedAt]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      downloadLogsBlob(await fetchClient.getBlob("/serverlogs"));
    } catch {
      // fetchClient already notifies on server and auth errors; a missing log file just downloads nothing
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card shadow="md" padding={0}>
      <Stack gap={0}>
        <Flex
          align="center"
          justify="space-between"
          wrap="wrap"
          gap="sm"
          p="md"
          style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
        >
          <Flex align="center" gap="xs" wrap="nowrap">
            <Title order={4} style={{ whiteSpace: "nowrap" }}>
              {t("adminarea.serverlogs")}
            </Title>
            {isFetching && <Loader size="xs" />}
          </Flex>
          <Flex align="center" gap="sm" wrap="wrap">
            <Flex align="center" gap="xs">
              <Text size="sm">{t("adminarea.serverlogslines")}</Text>
              <NumberInput value={linesInput} onChange={setLinesInput} min={1} max={1000} w={80} size="xs" />
            </Flex>
            <Button
              leftSection={<IconRefresh size={14} />}
              onClick={() => refetch()}
              loading={isFetching}
              size="xs"
              variant="default"
            >
              {t("adminarea.refresh")}
            </Button>
            <Tooltip label={t("adminarea.downloadserverlogs")}>
              <ActionIcon
                onClick={handleDownload}
                loading={isDownloading}
                variant="default"
                size="md"
                aria-label={t("adminarea.downloadserverlogs")}
              >
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>
        <ScrollArea h={400} viewportRef={viewportRef}>
          <Box
            p="md"
            style={{
              backgroundColor: "#1a1b1e",
              minHeight: 400,
            }}
          >
            <Text
              component="pre"
              size="xs"
              c="gray.3"
              style={{
                margin: 0,
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                // Break at spaces first; split a token only when it is longer than the line.
                overflowWrap: "anywhere",
              }}
            >
              {data?.logs ?? t("adminarea.serverlogsnone")}
            </Text>
          </Box>
        </ScrollArea>
      </Stack>
    </Card>
  );
}
