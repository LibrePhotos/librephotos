import type { AvatarProps } from "@mantine/core";
import { Avatar } from "@mantine/core";
import React from "react";
import { serverAddress } from "../../api_client/urls";

type AvatarUser = Readonly<{
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}>;

type Props = Readonly<
  Omit<AvatarProps, "src" | "name" | "color"> & {
    user: AvatarUser | undefined;
    /** The image's alternative text; "" when a name beside it says the same. */
    alt?: string;
  }
>;

/** "Sam Rivera", or the username when the user has no name. */
export function userDisplayName(user: AvatarUser): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username;
}

/**
 * A user's picture, or their initials on a colour picked from their name (the same colour every
 * time), as Google Photos and Immich show people without a picture, instead of a grey silhouette.
 */
export function UserAvatar({ user, alt = "", radius = "xl", ...props }: Props) {
  if (user?.avatar_url) {
    return <Avatar src={serverAddress + user.avatar_url} alt={alt} radius={radius} {...props} />;
  }
  return (
    <Avatar name={user ? userDisplayName(user) : undefined} color="initials" alt={alt} radius={radius} {...props} />
  );
}
