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
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
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
  a.download = "ownphotos.log";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function ServerLogsCard() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<number>(100);
  const { data, isFetching, refetch } = useFetchServerLogsViewQuery(lines);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch("/api/serverlogs", {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${document.cookie.match(/access=([^;]+)/)?.[1] ?? ""}`,
        },
      });
      if (response.ok) {
        const blob = await response.blob();
        downloadLogsBlob(blob);
      }
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
          p="md"
          style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
        >
          <Flex align="center" gap="xs">
            <Title order={4}>{t("adminarea.serverlogs")}</Title>
            {isFetching && <Loader size="xs" />}
          </Flex>
          <Flex align="center" gap="sm" wrap="wrap">
            <Flex align="center" gap="xs">
              <Text size="sm">{t("adminarea.serverlogslines")}</Text>
              <NumberInput
                value={lines}
                onChange={v => setLines(Number(v) || 100)}
                min={1}
                max={1000}
                w={80}
                size="xs"
              />
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
        <ScrollArea h={400}>
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
                wordBreak: "break-all",
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
