import type { PigPhoto } from "@librephotos/api-client";
import { Avatar } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { formatVideoTime } from "../../util/dateUtils";
import { sharerName } from "../sharing/sharerGroups";
import classes from "./BottomRightOverlay.module.css";
import { OwnerMarksContext } from "./ownerMarks";
import { TILE_GLYPH_SIZE, TileBadge, TileCorner } from "./TileBadge";

type Item = Pick<PigPhoto, "owner" | "person_video_time">;

/** In a person's photos: the moment of the video the person is at, where it opens (#2762). */
function PersonMomentBadge({ seconds }: Readonly<{ seconds: number }>) {
  const { t } = useTranslation();
  const time = formatVideoTime(seconds);
  return (
    <TileBadge title={t("phototile.personvideotime", { time })}>
      <IconUser size={TILE_GLYPH_SIZE} stroke={2.25} aria-hidden="true" />
      {time}
    </TileBadge>
  );
}

// Another user's photo, from a library they share with me (#2731): whose it is, so a mixed
// timeline is never ambiguous. In the public gallery (#434) every photo, mine too.
function OwnerMark({ item }: Readonly<{ item: Item }>) {
  const { t } = useTranslation();
  const everyPhoto = useContext(OwnerMarksContext);
  const { data: userDetails } = useCurrentUserSelfDetailsQuery(everyPhoto);
  const owner = item.owner;
  if (!owner || (!everyPhoto && (!userDetails || owner.id === userDetails.id))) return null;
  const name = sharerName(owner, owner.username);
  const label = t(everyPhoto ? "gallery.photoBy" : "librarySharing.photoOf", { name });
  return (
    <Avatar
      size={22}
      radius="xl"
      name={name}
      color="initials"
      role="img"
      aria-label={label}
      title={label}
      className={classes.ownerMark}
    />
  );
}

/** A tile's bottom-right corner: who it is from, and in a person's videos where they appear. */
export function BottomRightOverlay({ item }: Readonly<{ item: Item }>) {
  return (
    <TileCorner position="bottomRight">
      {typeof item.person_video_time === "number" && <PersonMomentBadge seconds={item.person_video_time} />}
      <OwnerMark item={item} />
    </TileCorner>
  );
}
