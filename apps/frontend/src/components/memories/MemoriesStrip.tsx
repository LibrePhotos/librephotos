import { Anchor, Box, Group, ScrollArea, Text } from "@mantine/core";
import { IconSparkles as Sparkles } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchMemoriesQuery } from "../../api_client/memories";
import { MemoryCard } from "./MemoryCard";
import { MemorySlideshow } from "./MemorySlideshow";

const TILE_SIZE = 150;

/** Today's memories as one scrollable row above the timeline; nothing when there are none. */
export function MemoriesStrip() {
  const { t } = useTranslation();
  const { data } = useFetchMemoriesQuery();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const memories = data?.results ?? [];

  if (memories.length === 0) {
    return null;
  }

  const playing = memories.find(memory => memory.id === playingId);

  return (
    <Box component="section" aria-label={t("memories.title")} px={10} pt={10}>
      <Group justify="space-between" mb={6}>
        <Group gap={6}>
          <Sparkles size={18} />
          <Text fw={500}>{t("memories.title")}</Text>
        </Group>
        <Anchor component={Link} to="/memories" size="sm">
          {t("memories.seeall")}
        </Anchor>
      </Group>
      <ScrollArea type="auto" scrollbarSize={6} offsetScrollbars="x">
        <Group gap={10} wrap="nowrap" align="flex-start" pb={4}>
          {memories.map(memory => (
            <Box key={memory.id} style={{ flex: "0 0 auto" }}>
              <MemoryCard memory={memory} size={TILE_SIZE} onPlay={() => setPlayingId(memory.id)} />
            </Box>
          ))}
        </Group>
      </ScrollArea>
      {playing ? <MemorySlideshow key={playing.id} items={playing.items} onClose={() => setPlayingId(null)} /> : null}
    </Box>
  );
}
