import { Button, Group, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { IconPlayerPlay as PlayerPlay, IconSparkles as Sparkles } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { MAX_MEMORY_ITEMS } from "../../api_client/memories";

export type MemoriesView = "tiles" | "gallery";

type Props = {
  view: MemoriesView;
  onViewChange: (view: MemoriesView) => void;
  onPlayAll: () => void;
  photoCount: number;
  /** True when at least one memory holds more photos than were returned. */
  capped: boolean;
  loading: boolean;
};

/**
 * Shared by both views: in the gallery it is handed to PhotoListView as its
 * header, so the page never stacks two headers on top of each other.
 */
export function MemoriesHeader({ view, onViewChange, onPlayAll, photoCount, capped, loading }: Props) {
  const { t } = useTranslation();

  return (
    <Stack gap="xs" mb={10} p={10}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm">
          <Sparkles size={50} />
          <Stack gap={0}>
            <Title order={2}>{t("memories.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("memories.subtitle")}
            </Text>
          </Stack>
        </Group>
        <Group gap="sm">
          <Button
            leftSection={<PlayerPlay size={16} />}
            variant="light"
            disabled={photoCount === 0}
            loading={loading}
            onClick={onPlayAll}
          >
            {t("memories.playall")}
          </Button>
          <SegmentedControl
            value={view}
            onChange={value => onViewChange(value as MemoriesView)}
            data={[
              { value: "tiles", label: t("memories.tiles") },
              { value: "gallery", label: t("memories.gallery") },
            ]}
          />
        </Group>
      </Group>
      {photoCount > 0 ? (
        <Text c="dimmed" size="sm">
          {t("memories.photocount", { count: photoCount })}
          {capped ? ` · ${t("memories.capped", { count: MAX_MEMORY_ITEMS })}` : ""}
        </Text>
      ) : null}
    </Stack>
  );
}
