import { ActionIcon, Anchor, Box, Group, ScrollArea, Text } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconSparkles as Sparkles } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchMemoriesQuery } from "../../api_client/memories";
import { PAGE_GUTTER_PX } from "../../uiConstants";
import classes from "./MemoriesStrip.module.css";
import { MemoryCard } from "./MemoryCard";
import { MemorySlideshow } from "./MemorySlideshow";

// The width of a card in the strip; it is 4:5, so 225px tall
const CARD_WIDTH = 180;

type Edges = Readonly<{ atStart: boolean; atEnd: boolean }>;

function edgesOf(viewport: HTMLDivElement): Edges {
  return {
    atStart: viewport.scrollLeft <= 1,
    atEnd: viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1,
  };
}

/**
 * Today's memories as one row of story cards above the timeline, scrolling sideways with faded
 * edges and arrow buttons on hover when they do not fit; nothing when there are none.
 */
export function MemoriesStrip() {
  const { t } = useTranslation();
  const { data } = useFetchMemoriesQuery();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({ atStart: true, atEnd: true });
  const memories = data?.results ?? [];
  const count = memories.length;

  // Whether the row overflows changes with the window, not only with a scroll
  useEffect(() => {
    const element = viewport.current;
    if (!element || count === 0) return undefined;
    const update = () => setEdges(edgesOf(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);

  if (memories.length === 0) {
    return null;
  }

  const playing = memories.find(memory => memory.id === playingId);
  const measure = () => {
    if (viewport.current) setEdges(edgesOf(viewport.current));
  };
  const scrollBy = (direction: 1 | -1) => {
    const element = viewport.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <Box component="section" aria-label={t("memories.title")} px={PAGE_GUTTER_PX} pt={10} className={classes.strip}>
      <Group gap={6} mb={8}>
        <Sparkles size={18} />
        <Text fw={600}>{t("memories.title")}</Text>
        <Text c="dimmed" aria-hidden>
          ·
        </Text>
        <Anchor component={Link} to="/memories" size="sm" className={classes.seeAll}>
          {t("memories.seeall")}
          <IconChevronRight size={14} aria-hidden />
        </Anchor>
      </Group>
      <div className={classes.scroller}>
        <ScrollArea
          viewportRef={viewport}
          type="never"
          className={classes.viewport}
          data-at-start={edges.atStart || undefined}
          data-at-end={edges.atEnd || undefined}
          onScrollPositionChange={measure}
        >
          <Group gap={12} wrap="nowrap" align="flex-start" pb={8}>
            {memories.map(memory => (
              <div key={memory.id} className={classes.slot}>
                <MemoryCard memory={memory} size={CARD_WIDTH} onPlay={() => setPlayingId(memory.id)} compact />
              </div>
            ))}
          </Group>
        </ScrollArea>
        {!edges.atStart && (
          <ActionIcon
            className={classes.arrow}
            data-side="start"
            variant="default"
            radius="xl"
            size="lg"
            aria-label={t("memories.scrollback")}
            onClick={() => scrollBy(-1)}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
        )}
        {!edges.atEnd && (
          <ActionIcon
            className={classes.arrow}
            data-side="end"
            variant="default"
            radius="xl"
            size="lg"
            aria-label={t("memories.scrollon")}
            onClick={() => scrollBy(1)}
          >
            <IconChevronRight size={18} />
          </ActionIcon>
        )}
      </div>
      {playing ? <MemorySlideshow key={playing.id} items={playing.items} onClose={() => setPlayingId(null)} /> : null}
    </Box>
  );
}
