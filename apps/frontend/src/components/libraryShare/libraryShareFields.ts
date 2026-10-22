import type { LibraryGrant, LibraryShare, LibraryShareSwitches, Photo, SimpleUser } from "@librephotos/api-client";
import {
  IconCamera,
  IconFileDownload,
  IconMapPin,
  IconTextCaption,
  IconUsers,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import { parseInstant } from "../../util/dateUtils";
import { sharerName } from "../sharing/sharerGroups";

/** The owner's switches of a library share (#2731), in the order the dialogs list them. */
export type SwitchField = keyof LibraryShareSwitches;

type SwitchConfig = Readonly<{
  field: SwitchField;
  /** The same switch in the photo detail's `shared_library`. */
  grant: keyof LibraryGrant;
  icon: TablerIcon;
  label: ParseKeys;
  description: ParseKeys;
  chipOn: ParseKeys;
  chipOff: ParseKeys;
}>;

export const LIBRARY_SWITCHES: readonly SwitchConfig[] = [
  {
    field: "share_location",
    grant: "location",
    icon: IconMapPin,
    label: "librarySharing.location",
    description: "librarySharing.locationDesc",
    chipOn: "librarySharing.chipLocation",
    chipOff: "librarySharing.chipNoLocation",
  },
  {
    field: "share_faces",
    grant: "people",
    icon: IconUsers,
    label: "librarySharing.people",
    description: "librarySharing.peopleDesc",
    chipOn: "librarySharing.chipPeople",
    chipOff: "librarySharing.chipNoPeople",
  },
  {
    field: "share_camera_info",
    grant: "camera",
    icon: IconCamera,
    label: "librarySharing.camera",
    description: "librarySharing.cameraDesc",
    chipOn: "librarySharing.chipCamera",
    chipOff: "librarySharing.chipNoCamera",
  },
  {
    field: "share_captions",
    grant: "captions",
    icon: IconTextCaption,
    label: "librarySharing.captions",
    description: "librarySharing.captionsDesc",
    chipOn: "librarySharing.chipCaptions",
    chipOff: "librarySharing.chipNoCaptions",
  },
  {
    field: "share_originals",
    grant: "originals",
    icon: IconFileDownload,
    label: "librarySharing.originals",
    description: "librarySharing.originalsDesc",
    chipOn: "librarySharing.chipOriginals",
    chipOff: "librarySharing.chipCopiesOnly",
  },
];

/** A new share starts with every switch off. */
export const ALL_OFF: LibraryShareSwitches = {
  share_location: false,
  share_faces: false,
  share_camera_info: false,
  share_captions: false,
  share_originals: false,
};

/** A share's switches, without the rest of the row. */
export function switchesOf(share: LibraryShare): LibraryShareSwitches {
  return {
    share_location: share.share_location,
    share_faces: share.share_faces,
    share_camera_info: share.share_camera_info,
    share_captions: share.share_captions,
    share_originals: share.share_originals,
  };
}

/** The name the dialogs and pages use for a user. */
export function personName(user: SimpleUser): string {
  return sharerName(user, user.username);
}

/** The first name alone where there is one ("What Ben sees"). */
export function firstName(user: SimpleUser): string {
  return user.first_name.length > 0 ? user.first_name : user.username;
}

/** A photo of a library someone shares with me, with what they share (#2731). */
export type LibraryPhoto = Photo & { shared_library: LibraryGrant };

/** Whether the requester sees `photo` as a photo of a library shared with them. */
export function isLibraryPhoto(photo: Photo): photo is LibraryPhoto {
  return photo.shared_library !== null && photo.shared_library !== undefined;
}

/** "Oct 3, 2026": when a share started. */
export function shareDate(share: LibraryShare): string {
  return parseInstant(share.created_at).toLocaleString({ month: "short", day: "numeric", year: "numeric" });
}
