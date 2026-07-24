import { ActionIcon, Tooltip } from "@mantine/core";
import { IconLayoutGrid, IconPhoto, IconScreenshot, IconVideo } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { type MediaType } from "./mediaTypeFilter";
import { useMediaTypeFilter } from "./useMediaTypeFilter";

const OPTIONS: ReadonlyArray<{ value: MediaType; icon: typeof IconPhoto; labelKey: string }> = [
  { value: "all", icon: IconLayoutGrid, labelKey: "mediafilter.all" },
  { value: "photos", icon: IconPhoto, labelKey: "mediafilter.photos" },
  { value: "videos", icon: IconVideo, labelKey: "mediafilter.videos" },
  { value: "screenshots", icon: IconScreenshot, labelKey: "mediafilter.screenshots" },
];

// A compact All / Photos / Videos toggle. Self-contained: it reads the active
// value from the current route's `?media` param and writes back via navigate,
// so a surface only needs to render it (no props) plus read useMediaTypeFilter()
// to feed its own data hook.
export function MediaTypeSelector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = useMediaTypeFilter();

  const select = (value: MediaType) => {
    navigate({
      // Clear the param for the default so the URL stays clean.
      search: (prev: Record<string, unknown>) => ({ ...prev, media: value === "all" ? undefined : value }),
    });
  };

  return (
    <ActionIcon.Group>
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const active = current === value;
        return (
          <Tooltip key={value} label={t(labelKey)} position="bottom">
            <ActionIcon
              variant={active ? "filled" : "subtle"}
              color="gray"
              size="lg"
              aria-label={t(labelKey)}
              aria-pressed={active}
              onClick={() => select(value)}
            >
              <Icon size={20} />
            </ActionIcon>
          </Tooltip>
        );
      })}
    </ActionIcon.Group>
  );
}
