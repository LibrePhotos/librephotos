import type { AlbumRole, ListUser, UserAlbum } from "@librephotos/api-client";

/** A user's place in an album in the share dialog: no access, or a member's role (#464). */
export type MemberRole = "none" | AlbumRole;

/** The role `user` has in `album`; an older server without roles shares only for viewing. */
export function memberRoleOf(album: UserAlbum | undefined, user: Pick<ListUser, "id">): MemberRole {
  const member = album?.members.find(m => m.user.id === user.id);
  if (member) return member.role;
  return album?.shared_to?.some(shared => shared.id === user.id) ? "viewer" : "none";
}

/** How many photos `user` added to `album`, which leave it when they stop contributing. */
export function contributedCount(album: UserAlbum | undefined, user: Pick<ListUser, "id">): number {
  const member = album?.members.find(m => m.user.id === user.id);
  return member?.role === "contributor" ? member.photo_count : 0;
}
