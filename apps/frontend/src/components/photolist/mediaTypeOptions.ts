import type { MediaType } from "@librephotos/api-client";
import {
  IconFileText,
  IconLayoutGrid,
  IconPhoto,
  IconScreenshot,
  IconVideo,
  type TablerIcon,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";

type MediaTypeOption = { icon: TablerIcon; color?: string; labelKey: ParseKeys };

// How the media filter names and draws each value; the colours are the view switcher's.
export const MEDIA_TYPE_OPTIONS: Record<MediaType, MediaTypeOption> = {
  all: { icon: IconLayoutGrid, labelKey: "mediafilter.allmedia" },
  photos: { icon: IconPhoto, color: "var(--mantine-color-blue-6)", labelKey: "mediafilter.photos" },
  videos: { icon: IconVideo, color: "var(--mantine-color-pink-6)", labelKey: "mediafilter.videos" },
  screenshots: { icon: IconScreenshot, color: "var(--mantine-color-violet-6)", labelKey: "mediafilter.screenshots" },
  documents: { icon: IconFileText, color: "var(--mantine-color-orange-7)", labelKey: "mediafilter.documents" },
};
