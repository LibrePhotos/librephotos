import {
  albumKeys,
  endpoints,
  faceKeys,
  invalidateAfter,
  photoKeys,
  ResponseParseError,
  statsKeys,
} from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { apiClient, ApiError, queryClient } from "../../api";
import { drawnFaceResults, type AddFaceRequest } from "../drawnFaceResults";

const addFace = (data: AddFaceRequest) =>
  endpoints.addFace(apiClient, data.photo, data.personName, data.box, data.fit).then(payload => {
    notification.addFacesToPerson(payload.face.person_name, 1);
    return payload;
  });

/** The server looked inside the drawn box and found no face there (#1117). */
function isNoFaceInBox(error: unknown): boolean {
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

/**
 * Add a face drawn by hand. With `fit` (the drawing always sends it) the server looks for the face
 * in the box (#1117): while it does, and when there is none, `drawnFaceResults` says so for the
 * photo's People section, which offers to keep the box as drawn (the same request without `fit`).
 */
export const useAddFaceMutation = () =>
  useMutation({
    mutationFn: addFace,
    onMutate: request => {
      if (request.fit) drawnFaceResults.set({ state: "finding", request });
      else drawnFaceResults.clear(request.photo);
    },
    onError: (error, request) => {
      if (isNoFaceInBox(error)) drawnFaceResults.set({ state: "notfound", request });
      else drawnFaceResults.clear(request.photo);
      reportAddFaceError(error);
    },
    onSuccess: (data, request) => {
      drawnFaceResults.clear(request.photo);
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
