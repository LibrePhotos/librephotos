import { Badge, UnstyledButton } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Tile } from "../../Tile";
import classes from "./AlbumEditModal.module.css";

type Props = Readonly<{
  title: string;
  /** The one dimmed line: "7 items · Created 7 hours ago", or whose shared album it is. */
  meta: string;
  cover?: Readonly<{ image_hash: string; video?: boolean }> | null;
  /** A locked album (#867) is listed but takes no photos: the row says so and does nothing. */
  locked?: boolean;
  onPick: () => void;
}>;

/**
 * An album in the add-to-album picker: a 56px row of the one list, its 48px cover (8px corners), the
 * title in 14/500 and one dimmed meta line, with a hover background (Google Photos' picker).
 */
export function AlbumPickerRow({ title, meta, cover, locked = false, onPick }: Props) {
  const { t } = useTranslation();
  return (
    <UnstyledButton
      className={classes.row}
      disabled={locked}
      aria-label={locked ? t("useralbum.lockedCannotAdd", { title }) : undefined}
      onClick={() => {
        if (!locked) onPick();
      }}
    >
      {cover ? (
        <Tile height={48} width={48} className={classes.cover} image_hash={cover.image_hash} video={cover.video} />
      ) : (
        <span className={classes.coverPlaceholder}>
          <IconPhoto size={20} stroke={1.5} />
        </span>
      )}
      <span className={classes.rowText}>
        <span className={classes.rowTitle} data-album-title>
          {title}
        </span>
        <span className={classes.rowMeta}>{meta}</span>
      </span>
      {locked && (
        <Badge color="gray" variant="light" className={classes.badge}>
          {t("useralbum.locked")}
        </Badge>
      )}
    </UnstyledButton>
  );
}
