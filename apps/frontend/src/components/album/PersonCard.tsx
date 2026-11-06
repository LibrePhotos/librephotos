import { Image } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { CollectionCard, collectionCardImageClass } from "../common/CollectionCard";
import { faceImageUrl } from "../facedashboard/personCover";
import { Tile } from "../Tile";

type PersonShown = Pick<Person, "id" | "name" | "video" | "face_count" | "face_photo_url" | "face_url">;

type Props = Readonly<{
  person: PersonShown;
  /** The card's width; it is a third taller. */
  size: number;
  /** The ⋮ menu's items. */
  menuItems?: ReactNode;
  onMenuOpen?: (trigger: HTMLButtonElement) => void;
}>;

const PLACEHOLDER = "/unknown_user.jpg";

/** The legacy name of the catch-all person, shown as the placeholder rather than one of its faces. */
const LEGACY_UNKNOWN_NAME = "unknown";

/**
 * The picture: their cover face crop, else the whole cover photo, else (or for nobody in
 * particular) the placeholder. Decorative: the name is on the card.
 */
function PersonPicture({ person, size }: Readonly<{ person: PersonShown; size: number }>) {
  const hasFaces = person.face_count > 0 && person.name !== LEGACY_UNKNOWN_NAME;
  const height = Math.round((size * 4) / 3);
  if (hasFaces && person.face_url) {
    return (
      <Image
        src={faceImageUrl(person.face_url)}
        fallbackSrc={PLACEHOLDER}
        w={size}
        h={height}
        className={collectionCardImageClass}
        alt=""
      />
    );
  }
  if (hasFaces && person.face_photo_url) {
    return (
      <Tile
        video={person.video}
        width={size}
        height={height}
        image_hash={person.face_photo_url}
        className={collectionCardImageClass}
      />
    );
  }
  return <Image src={PLACEHOLDER} w={size} h={height} className={collectionCardImageClass} alt="" />;
}

/**
 * A person on the People page: a 3:4 portrait of their face with the name and face count on it,
 * like the album covers (CollectionCard). It opens the person unless they have no faces to show.
 */
export function PersonCard({ person, size, menuItems, onMenuOpen }: Props) {
  const { t } = useTranslation();
  return (
    <CollectionCard
      shape="portrait"
      size={size}
      title={person.name}
      // face_count counts faces, not photos
      meta={t("facesdashboard.numberoffaces", { count: person.face_count, number: person.face_count })}
      media={<PersonPicture person={person} size={size} />}
      renderLink={
        person.face_count === 0
          ? undefined
          : props => <Link {...props} to="/album/persons/$id" params={{ id: person.id }} />
      }
      menuLabel={t("moreactions")}
      menuItems={menuItems}
      onMenuOpen={onMenuOpen}
    />
  );
}
