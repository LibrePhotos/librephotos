import { Button, SegmentedControl } from "@mantine/core";
import { IconPlayerPlay as PlayerPlay, IconSparkles as Sparkles } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { MAX_MEMORY_ITEMS } from "../../api_client/memories";
import { ICON_SIZE } from "../../uiConstants";
import { PageHeader } from "../PageHeader";

export type MemoriesView = "tiles" | "gallery";

const isMemoriesView = (value: string): value is MemoriesView => value === "tiles" || value === "gallery";

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
    <PageHeader
      icon={Sparkles}
      title={t("memories.title")}
      subtitle={
        <>
          <div>{t("memories.subtitle")}</div>
          {photoCount > 0 ? (
            <div>
              {t("memories.photocount", { count: photoCount })}
              {capped ? ` · ${t("memories.capped", { count: MAX_MEMORY_ITEMS })}` : ""}
            </div>
          ) : null}
        </>
      }
      actions={
        <>
          <Button
            leftSection={<PlayerPlay size={ICON_SIZE.toolbar} />}
            variant="light"
            disabled={photoCount === 0}
            loading={loading}
            onClick={onPlayAll}
          >
            {t("memories.playall")}
          </Button>
          <SegmentedControl
            value={view}
            onChange={value => {
              if (isMemoriesView(value)) onViewChange(value);
            }}
            data={[
              { value: "tiles", label: t("memories.tiles") },
              { value: "gallery", label: t("memories.gallery") },
            ]}
          />
        </>
      }
    />
  );
}
