import type { CompletePersonFace } from "../../api_client/faces/types";
import type { LightboxItem } from "../lightbox/lightbox.types";
import type { VideoStart } from "../lightbox/videoStart";
import { videoStartOf } from "../lightbox/videoStart";
import { isNamedPerson } from "./faceActionRules";
import type { FaceCell } from "./hooks/useVirtualizedGrid";

/** The face a lightbox was opened from: its photo, and where its video starts. */
export type FaceVideoStart = { photoId: string; start: VideoStart };

/**
 * Where the video of `face` opens (#2762): at the face's `video_time`, with the name of the person
 * whose group it is in, if that is a person the user named. Null for a photo or a first-frame face.
 */
export function faceVideoStart(groups: CompletePersonFace[], face: FaceCell): FaceVideoStart | null {
  const group = groups.find(person => person.faces.some(candidate => candidate.id === face.id));
  const start = videoStartOf(face.video_time, group && isNamedPerson(group) ? group.name : undefined);
  return start && face.photo ? { photoId: face.photo, start } : null;
}

/**
 * The lightbox items with the start on the entries of the video the face was in. A video with
 * faces of several people has an entry per face, and the lightbox shows the first of them, so
 * each gets the start of the face that was clicked.
 */
export function withFaceVideoStart(items: LightboxItem[], opened: FaceVideoStart | null): LightboxItem[] {
  if (!opened) return items;
  return items.map(item => (item.id === opened.photoId ? { ...item, videoStart: opened.start } : item));
}
