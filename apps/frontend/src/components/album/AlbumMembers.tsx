import type { SimpleUser } from "@librephotos/api-client";
import { Avatar, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { UserAvatar } from "../common/UserAvatar";

type Props = Readonly<{
  owner: SimpleUser;
  sharedTo: readonly SimpleUser[];
  /** Whether the viewer owns the album: they see who it is shared with, a recipient whose it is. */
  own: boolean;
  /** A recipient who may add photos (#464). */
  contributor?: boolean;
}>;

const MAX_AVATARS = 5;

const displayName = (user: SimpleUser) => user.first_name || user.username;

/**
 * A user album's people under its title, as Immich heads an album: the owner's face for a
 * recipient ("Owned by Ana · You can add photos"), the recipients' faces for the owner ("Shared
 * with 2 people"). Nothing for an album of one's own that is not shared.
 */
export function AlbumMembers({ owner, sharedTo, own, contributor = false }: Props) {
  const { t } = useTranslation();
  const { data: users } = useFetchUserListQuery();
  const people = own ? sharedTo : [owner];
  if (people.length === 0) return null;

  // The user list has the avatars; without one, the initials on the user's colour
  const avatarUrlOf = (user: SimpleUser) => users?.find(candidate => candidate.id === user.id)?.avatar_url;
  const label = own
    ? t("useralbum.sharedwithcount", { count: sharedTo.length })
    : [t("useralbum.ownedby", { name: displayName(owner) }), contributor ? t("collab.youCanAdd") : null]
        .filter(Boolean)
        .join(" · ");

  return (
    <>
      <Avatar.Group spacing="xs">
        {people.slice(0, MAX_AVATARS).map(user => (
          <Tooltip key={user.id} label={displayName(user)} withArrow>
            <UserAvatar user={{ ...user, avatar_url: avatarUrlOf(user) }} size={28} alt={displayName(user)} />
          </Tooltip>
        ))}
        {people.length > MAX_AVATARS ? (
          <Avatar radius="xl" size={28}>{`+${people.length - MAX_AVATARS}`}</Avatar>
        ) : null}
      </Avatar.Group>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </>
  );
}
