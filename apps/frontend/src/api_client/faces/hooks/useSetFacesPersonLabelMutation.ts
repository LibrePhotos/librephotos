import { endpoints, UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import type { FaceLabels } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { apiClient } from "../../api";
import { invalidateFaceEdits } from "./invalidateFaceEdits";
import { useRestoreFaceLabelsMutation } from "./useRestoreFaceLabelsMutation";

type SetFacesLabelRequest = { faceIds: number[]; personName: string };

const setFacesPersonLabel = (data: SetFacesLabelRequest) =>
  endpoints.labelFaces(apiClient, data.faceIds, data.personName);

export const useSetFacesPersonLabelMutation = () => {
  const queryClient = useQueryClient();
  // The toast's Undo gives the faces back their people (#127); older servers send no `previous`
  const { mutateAsync: restoreLabels } = useRestoreFaceLabelsMutation();
  const undoOf = (previous: FaceLabels[] | undefined) =>
    previous && previous.length > 0 ? () => restoreLabels(previous) : undefined;

  return useMutation({
    mutationFn: setFacesPersonLabel,
    // The toast waits for the server: "not this person" used to claim success before it answered.
    onSuccess: (data, { personName }) => {
      const undo = undoOf(data.previous);
      if (personName === UNKNOWN_PERSON_NAME) {
        // Who training no longer suggests for the faces (#2747); older servers do not say
        const rejectedNames = (data.rejected_people ?? []).map(person => person.name);
        if (rejectedNames.length > 0) {
          notification.rejectFacesFromPeople(rejectedNames, data.results.length, undo);
        } else {
          notification.removeFacesFromPerson(data.results.length, undo);
        }
      } else {
        notification.addFacesToPerson(data.results[0]?.person_name ?? "unknown", data.results.length, undo);
      }

      // Every tagging path funnels through this mutation, so this is the one
      // place that sees all of them. `person` is null when faces are pushed back
      // to "Unknown - Other", which is not a pick worth remembering.
      recordRecentlyTaggedPerson(data.results[0]?.person);

      invalidateFaceEdits(queryClient);
    },
  });
};
