import { Image } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import type { Person } from "../../api_client/albums/hooks";
import { faceImageUrl } from "../facedashboard/personCover";
import { Tile } from "../Tile";
import classes from "./PersonFace.module.css";

type Props = Readonly<{
  person: Pick<Person, "id" | "name" | "video" | "face_count" | "face_photo_url" | "face_url">;
  /** The side of the square cell the picture fills. */
  size: number;
}>;

const PLACEHOLDER = "/unknown_user.jpg";

/** The legacy name of the catch-all person, shown as the placeholder rather than one of its faces. */
const LEGACY_UNKNOWN_NAME = "unknown";

/**
 * What a person looks like on the People page (#2241): a round crop of their cover face, as on
 * the album hub. Without a crop the whole cover photo stands in as a square tile, and without
 * either (or for nobody in particular) the round placeholder. The picture names the person,
 * because the link around it has no other text.
 */
function PersonPicture({ person, size }: Props) {
  const hasFaces = person.face_count > 0 && person.name !== LEGACY_UNKNOWN_NAME;
  if (hasFaces && person.face_url) {
    return (
      <Image
        src={faceImageUrl(person.face_url)}
        fallbackSrc={PLACEHOLDER}
        w={size}
        h={size}
        className={classes.face}
        alt={person.name}
      />
    );
  }
  if (hasFaces && person.face_photo_url) {
    return (
      <Tile
        video={person.video}
        width={size}
        height={size}
        image_hash={person.face_photo_url}
        className={classes.photo}
        alt={person.name}
      />
    );
  }
  return <Image src={PLACEHOLDER} w={size} h={size} className={classes.face} alt={person.name} />;
}

/** A person's picture in a People grid cell, linking to the person unless they have no faces to show. */
export function PersonFace({ person, size }: Props) {
  if (person.face_count === 0) {
    return <PersonPicture person={person} size={size} />;
  }
  return (
    <Link to="/album/persons/$id" params={{ id: person.id }} className={classes.link}>
      <PersonPicture person={person} size={size} />
    </Link>
  );
}
