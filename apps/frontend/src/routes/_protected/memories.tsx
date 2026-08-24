import { Group, Stack } from "@mantine/core";
import { IconSparkles as Sparkles } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_MEMORY_ITEMS, useFetchMemoriesQuery } from "../../api_client/memories";
import { EmptyState } from "../../components/common/EmptyState";
import { MemoriesHeader, MemoriesView } from "../../components/memories/MemoriesHeader";
import { MemoryCard } from "../../components/memories/MemoryCard";
import {
  memoriesAreCapped,
  memoriesPhotoCount,
  memoriesToFlatItems,
  memoriesToPhotoGroups,
} from "../../components/memories/memoryPhotoset";
import { MemorySlideshow } from "../../components/memories/MemorySlideshow";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/memories")();

/** What the lightbox is playing: one year's memory, or every year in a row. */
type Playing = { kind: "all" } | { kind: "one"; id: string };

export function Memories() {
  const { t } = useTranslation();
  const [view, setView] = useState<MemoriesView>("tiles");
  const [playing, setPlaying] = useState<Playing | null>(null);
  // The tiles need only a cover each; showing the whole day at once -- as a
  // gallery, or as one slideshow across the years -- is what justifies asking
  // the backend for every photo it will give.
  const [wantsEveryPhoto, setWantsEveryPhoto] = useState(false);

  const summary = useFetchMemoriesQuery();
  const everyPhoto = useFetchMemoriesQuery({ size: MAX_MEMORY_ITEMS, enabled: wantsEveryPhoto });
  const memories = everyPhoto.data?.results ?? summary.data?.results ?? [];
  const isFetching = summary.isFetching || everyPhoto.isFetching;
  const isError = summary.isError || everyPhoto.isError;

  // One memory per year, so there is nothing to virtualize -- but the tiles are
  // sized like the album grids so the two pages look like the same product.
  const { entrySquareSize } = useAlbumListGridConfig(memories);
  const tileSize = Math.max(entrySquareSize - 10, 0);

  const items = memoriesToFlatItems(memories);
  const playingItems =
    playing?.kind === "all" ? items : (memories.find(memory => memory.id === playing?.id)?.items ?? []);

  const emptyStateConfig = {
    icon: <Sparkles size={40} />,
    title: t("memories.emptytitle"),
    description: t("memories.emptydescription"),
  };

  const header = (
    <MemoriesHeader
      view={view}
      onViewChange={next => {
        if (next === "gallery") {
          setWantsEveryPhoto(true);
        }
        setView(next);
      }}
      onPlayAll={() => {
        // Starts with the photos already in hand and grows into the full set as
        // it arrives, rather than making the user wait for the bigger request.
        setWantsEveryPhoto(true);
        setPlaying({ kind: "all" });
      }}
      // The count is what the day holds, not what was fetched; the cap is only
      // worth mentioning once every photo has been asked for and some memory
      // still came back short.
      photoCount={memoriesPhotoCount(memories)}
      capped={Boolean(everyPhoto.data) && memoriesAreCapped(memories)}
      loading={isFetching}
    />
  );

  return (
    <>
      {view === "gallery" ? (
        <PhotoListView
          // The header is handed to PhotoListView instead of being placed above
          // it, so the gallery lays out like every other photo list.
          header={header}
          title={t("memories.title")}
          loading={isFetching && items.length === 0}
          icon={<Sparkles size={50} />}
          photoset={memoriesToPhotoGroups(memories)}
          idx2hash={items}
          numberOfItems={items.length}
          selectable
          emptyStateConfig={emptyStateConfig}
        />
      ) : (
        <Stack gap={0}>
          {header}
          {memories.length > 0 ? (
            <Group gap={10} p={10} align="flex-start">
              {memories.map(memory => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  size={tileSize}
                  onPlay={() => setPlaying({ kind: "one", id: memory.id })}
                />
              ))}
            </Group>
          ) : null}
          {/* Only claim there is nothing to remember when the request actually
              answered: a failed one already raises its own notification. */}
          {!isFetching && !isError && memories.length === 0 ? <EmptyState {...emptyStateConfig} /> : null}
        </Stack>
      )}
      {playing ? (
        // Keyed by what is playing, so picking another memory starts its
        // slideshow at the beginning rather than where the last one stopped.
        <MemorySlideshow
          key={playing.kind === "all" ? "all" : playing.id}
          items={playingItems}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </>
  );
}

Route.update({ component: Memories });
