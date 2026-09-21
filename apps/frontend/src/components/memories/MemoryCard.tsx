import { ActionIcon, Group, Stack, Text } from "@mantine/core";
import { IconPlayerPlay as PlayerPlay } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Memory } from "../../api_client/memories";
import { i18nResolvedLanguage } from "../../i18n";
import { Tile } from "../Tile";
import { memoryDayLabel, memoryMonthLabel } from "./memoryLabels";

type Props = {
  memory: Memory;
  size: number;
  onPlay: () => void;
};

export function MemoryCard({ memory, size, onPlay }: Props) {
  const { t } = useTranslation();
  const locale = i18nResolvedLanguage();
  const title = memoryMonthLabel(memory, locale) ?? t("memories.yearsago", { count: memory.years_ago });
  const details = [memoryDayLabel(memory, locale), memory.location || null].filter(Boolean).join(" · ");

  return (
    <Stack gap={2} style={{ width: size }}>
      <button
        type="button"
        onClick={onPlay}
        title={t("memories.play")}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", position: "relative" }}
      >
        <Tile video={false} height={size} width={size} image_hash={memory.cover.image_hash} />
        <ActionIcon
          component="span"
          variant="filled"
          color="dark"
          radius="xl"
          style={{ position: "absolute", bottom: 8, right: 8, opacity: 0.85 }}
        >
          <PlayerPlay size={16} />
        </ActionIcon>
      </button>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" fw={500} lineClamp={1} title={title}>
          {title}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {t("memories.photocount", { count: memory.numberOfItems })}
        </Text>
      </Group>
      {details ? (
        <Text size="xs" c="dimmed" lineClamp={1} title={details}>
          {details}
        </Text>
      ) : null}
    </Stack>
  );
}
