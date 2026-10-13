import type { CompletePersonFace } from "../../api_client/faces/types";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { isUnknownGroup } from "./facesTab";

/** A face crop's URL from the stored image's URL or path (only its file name counts). */
export function faceImageUrl(image: string): string {
  const fileName = image.split("/").at(-1) ?? "";
  return mediaUrl.face(fileName);
}

/**
 * The face that stands for a group on the dashboard (#860): the person's own cover (the People
 * page's, `ownCover`), else the group's first face once it is paged in (clusters have no cover of
 * their own). Undefined while there is neither, and always for "Unknown - Other", which is no one:
 * the avatar then shows its generic placeholder.
 */
export function coverFaceUrl(group: CompletePersonFace, ownCover: string | undefined): string | undefined {
  if (isUnknownGroup(group)) return undefined;
  if (ownCover) return faceImageUrl(ownCover);
  // A placeholder has no image yet
  const image = group.faces[0]?.image;
  return image ? faceImageUrl(image) : undefined;
}

/**
 * A collapsed group shows no faces, so nothing pages its faces in. A cluster has no cover of its
 * own, so it needs its first page for its cover face. People have their own cover, and "Unknown -
 * Other" shows none.
 */
export function needsCoverPage(group: CompletePersonFace): boolean {
  return group.kind === "CLUSTER" && group.faces[0]?.isTemp === true;
}
