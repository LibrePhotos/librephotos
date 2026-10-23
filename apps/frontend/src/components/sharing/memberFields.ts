import type { AlbumMemberCeiling, AlbumMemberSwitches, UserAlbum } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";

/** A detail of a photo that album members see only where both sides allow it (#464). */
export type MemberField = {
  /** The member's own switch (`AlbumMemberSwitches`). */
  member: keyof AlbumMemberSwitches;
  /** The album owner's ceiling for it (`UserAlbum.members_share_*`). */
  ceiling: keyof AlbumMemberCeiling;
  label: ParseKeys;
};

export const MEMBER_FIELDS: readonly MemberField[] = [
  { member: "share_location", ceiling: "members_share_location", label: "collab.fieldLocation" },
  { member: "share_faces", ceiling: "members_share_faces", label: "collab.fieldFaces" },
  { member: "share_camera_info", ceiling: "members_share_camera_info", label: "collab.fieldCamera" },
  { member: "share_captions", ceiling: "members_share_captions", label: "collab.fieldCaptions" },
  { member: "share_originals", ceiling: "members_share_originals", label: "collab.fieldOriginals" },
];

/** Whether the album's owner lets members see `field`; on unless the server says otherwise. */
export function ceilingAllows(album: Pick<UserAlbum, keyof AlbumMemberCeiling> | undefined, field: MemberField) {
  return album?.[field.ceiling] ?? true;
}
