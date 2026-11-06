import type { AutoAlbumInfo } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { IconTrash as Trash } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useEventTitle } from "../../hooks/useEventTitle";
import { CollectionCard } from "../common/CollectionCard";
import classes from "./EventCard.module.css";
import { eventStartDate } from "./eventDate";

type Props = Readonly<{
  album: AutoAlbumInfo;
  /** The card's width in px. */
  size: number;
  onDelete: (album: AutoAlbumInfo) => void;
}>;

/**
 * An event on /album/events: the collection card with the title on the photo (two lines at most)
 * and the date and count under it in the small-caps line the Memories cards use, over a stronger
 * gradient, since generated titles run long and covers are often bright.
 */
export function EventCard({ album, size, onDelete }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const eventTitle = useEventTitle();
  const start = eventStartDate(album);
  const date = start.isValid ? start.toLocaleString(DateTime.DATE_MED) : null;
  const count = t("numberofphotos", { count: album.photo_count, number: album.photo_count });
  return (
    <CollectionCard
      size={size}
      title={eventTitle(album)}
      meta={date ? `${date} · ${count}` : count}
      covers={[album.photos]}
      renderLink={props => (
        <Link
          {...props}
          className={clsx(props.className, classes.frame)}
          to="/album/events/$id"
          params={{ id: String(album.id) }}
        />
      )}
      menuLabel={t("moreactions")}
      menuItems={
        <Menu.Item leftSection={<Trash size={14} />} onClick={() => onDelete(album)}>
          {t("delete")}
        </Menu.Item>
      }
    />
  );
}
