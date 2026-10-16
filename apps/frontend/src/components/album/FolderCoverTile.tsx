import type { FolderSubfolder } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import { IconFolder } from "@tabler/icons-react";
import React from "react";
import { Tile } from "../Tile";
import classes from "./FolderCoverTile.module.css";

type Props = Readonly<{
  folder: Pick<FolderSubfolder, "cover_photo">;
  size: number;
}>;

/**
 * A Folders page tile (#2233): the folder's newest photo with a small folder badge, so a folder
 * still reads as one next to an album; the folder icon when the server sends no cover.
 */
export function FolderCoverTile({ folder, size }: Props) {
  const cover = folder.cover_photo;
  if (!cover?.image_hash) {
    return (
      <Box className={classes.iconTile} w={size} h={size}>
        <IconFolder size={40} stroke={1.5} />
      </Box>
    );
  }
  return (
    <Box className={classes.coverTile} w={size} h={size}>
      <Tile className={classes.cover} image_hash={cover.image_hash} video={cover.video} width={size} height={size} />
      <span className={classes.badge} aria-hidden>
        <IconFolder size={14} />
      </span>
    </Box>
  );
}
