import type { Memory } from "@librephotos/api-client";
import { Media } from "@librephotos/api-client";
import { IconPlayerPlayFilled as PlayerPlay } from "@tabler/icons-react";
import clsx from "clsx";
import React from "react";
import { useTranslation } from "react-i18next";
import { Tile } from "../Tile";
import classes from "./MemoryCard.module.css";
import { memoryDayLabel, memoryMonthLabel } from "./memoryLabels";

type Props = {
  memory: Memory;
  /** The card's width in px, for the cover's size attributes; the card itself fills its slot. */
  size: number;
  onPlay: () => void;
  /** Smaller type and play button, for the timeline's strip. */
  compact?: boolean;
};

/**
 * A memory as a story card (4:5): the cover fills it, "2 years ago" sits on it in bold white over
 * a soft gradient with the place and day in small capitals under it, and a round play button in
 * the corner. The whole card plays the memory.
 */
export function MemoryCard({ memory, size, onPlay, compact = false }: Props) {
  const { t } = useTranslation();
  const title = memoryMonthLabel(memory) ?? t("memories.yearsago", { count: memory.years_ago });
  const details = [memory.location || null, memoryDayLabel(memory)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onPlay}
      title={t("memories.play")}
      className={clsx(classes.card, compact && classes.compact)}
    >
      {/* A day of only videos has a video cover, whose square thumbnail is an MP4 */}
      <Tile
        video={memory.cover.type === Media.VIDEO}
        height={Math.round((size * 5) / 4)}
        width={size}
        image_hash={memory.cover.image_hash}
        className={classes.image}
      />
      <span className={classes.scrim} />
      <span className={classes.text}>
        <span className={classes.title}>{title}</span>
        {details ? <span className={classes.details}>{details}</span> : null}
      </span>
      <span className={classes.play} aria-hidden>
        <PlayerPlay size={16} />
      </span>
    </button>
  );
}
