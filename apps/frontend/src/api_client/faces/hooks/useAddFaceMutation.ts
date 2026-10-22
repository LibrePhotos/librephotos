import {
  albumKeys,
  endpoints,
  faceKeys,
  invalidateAfter,
  photoKeys,
  ResponseParseError,
  statsKeys,
  type NormalizedFaceBox,
} from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { apiClient, ApiError, queryClient } from "../../api";

/** `fit`: the box only says where to look, the server saves the face it finds there (#1117). */
type AddFaceRequest = { photo: string; personName: string; box: NormalizedFaceBox; fit?: boolean };

const addFace = (data: AddFaceRequest) =>
  endpoints.addFace(apiClient, data.photo, data.personName, data.box, data.fit).then(payload => {
    notification.addFacesToPerson(payload.face.person_name, 1);
    return payload;
  });

/** The server looked inside the drawn box and found no face there (#1117). */
export function isNoFaceInBox(error: unknown): boolean {
  return error instanceof ApiError && error.serverCode === "no_face_in_box";
}

/**
 * The server refuses a box with a 4xx and a plain `{status, message}` body
 * (English, and not picked up as `serverMessage`), so say why by status.
 * A 401 or 500 has its own toast already, and so does a response that fails to parse.
 */
export function reportAddFaceError(error: unknown) {
  if (error instanceof ResponseParseError) return;
  if (error instanceof ApiError && (error.status === 401 || error.status === 500)) return;
  // The drawing offers to keep the box as drawn or to draw again instead
  if (isNoFaceInBox(error)) return;
  const status = error instanceof ApiError ? error.status : undefined;
  let message = i18n.t("toasts.addfacefailed");
  if (status === 409) message = i18n.t("toasts.addfaceoverlap");
  else if (status === 404) message = i18n.t("toasts.addfacenotowner");
  notification.requestFailed(i18n.t("toasts.addfacefailedtitle"), message);
}

export const useAddFaceMutation = () =>
  useMutation({
    mutationFn: addFace,
    onError: reportAddFaceError,
    onSuccess: data => {
      // Drawing a box by hand is a tagging choice like any other, so it belongs
      // in the recently-tagged shortcut list too.
      recordRecentlyTaggedPerson(data.face.person);

      // Same delay the other face mutations use, for the writes that follow the
      // response (face count, cover photo, search captions).
      invalidateAfter(queryClient, [
        faceKeys.incomplete(),
        faceKeys.personFaces(),
        albumKeys.peopleAlbums(),
        statsKeys.counts(),
        photoKeys.details(),
      ]);
    },
  });
