import { MAX_MEMORY_ITEMS } from "@librephotos/api-client";
import { ActionIcon, Button, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPlayerPlay as PlayerPlay } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { Segmented } from "../common/Segmented";
import { PageHeader } from "../PageHeader";

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
  const theme = useMantineTheme();
  // Read at once rather than after mounting, so a phone never shows the wide button first
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });

  const counts =
    photoCount > 0
      ? ` · ${t("memories.photocount", { count: photoCount })}${capped ? ` · ${t("memories.capped", { count: MAX_MEMORY_ITEMS })}` : ""}`
      : "";
  const playAll = t("memories.playall");

  // One meta line, then the view control and the page's one action, tonal (Play all): the same
  // order as every page header. Play all is an icon with a tooltip on a phone.
  return (
    <PageHeader
      title={t("memories.title")}
      subtitle={`${t("memories.subtitle")}${counts}`}
      actions={
        <>
          <Segmented<MemoriesView>
            value={view}
            onChange={onViewChange}
            segments={[
              { value: "tiles", label: t("memories.tiles") },
              { value: "gallery", label: t("memories.gallery") },
            ]}
          />
          {isPhone ? (
            <DisabledReason reason={photoCount === 0 ? t("memories.emptytitle") : null} label={playAll}>
              <ActionIcon
                variant="light"
                size={TOOLBAR_ACTION_SIZE}
                aria-label={playAll}
                loading={loading}
                onClick={onPlayAll}
              >
                <PlayerPlay size={ICON_SIZE.toolbar} />
              </ActionIcon>
            </DisabledReason>
          ) : (
            <DisabledReason reason={photoCount === 0 ? t("memories.emptytitle") : null}>
              <Button
                variant="light"
                leftSection={<PlayerPlay size={ICON_SIZE.toolbar} />}
                h={TOOLBAR_CONTROL_HEIGHT}
                loading={loading}
                onClick={onPlayAll}
              >
                {playAll}
              </Button>
            </DisabledReason>
          )}
        </>
      }
    />
  );
}
