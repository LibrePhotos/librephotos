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

// Calm hues only: red and orange mean errors and warnings elsewhere in the app.
const INITIALS_COLORS = ["blue", "indigo", "teal", "green", "grape", "cyan", "violet", "gray"] as const;

/** The same colour for a name every time (a small string hash into INITIALS_COLORS). */
function initialsColor(name: string): (typeof INITIALS_COLORS)[number] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  return INITIALS_COLORS[hash % INITIALS_COLORS.length] ?? "gray";
}

/**
 * A user's picture, or their initials on a soft tint picked from their name (the same one every
 * time), as Google Photos and Immich show people without a picture, instead of a grey silhouette.
 */
export function UserAvatar({ user, alt = "", radius = "xl", ...props }: Props) {
  if (user?.avatar_url) {
    return <Avatar src={serverAddress + user.avatar_url} alt={alt} radius={radius} {...props} />;
  }
  const name = user ? userDisplayName(user) : "";
  return (
    <Avatar name={name || undefined} color={initialsColor(name)} variant="light" alt={alt} radius={radius} {...props} />
  );
}
