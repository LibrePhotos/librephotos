import { albumKeys, endpoints } from "@librephotos/api-client";
import type { PersonSharing } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

// Sharing one of your people with other users (#668): who sees it, and the review of the photos
// labelled after it was shared, which nobody sees until you approve them.

export const usePersonSharingQuery = (personId: number, enabled = true) =>
  useQuery({
    queryKey: albumKeys.personSharing(personId),
    queryFn: () => endpoints.fetchPersonSharing(apiClient, personId),
    enabled,
  });

export const usePersonSharingPendingQuery = (personId: number, enabled: boolean) =>
  useQuery({
    queryKey: albumKeys.personSharingPending(personId),
    queryFn: () => endpoints.fetchPersonSharingPending(apiClient, personId),
    enabled,
  });

type SharingBody = { recipient_ids: number[]; share_location?: boolean; share_other_people?: boolean };

/** Who the person is shared with and what they see; the answer replaces the cached sharing. */
export const useSetPersonSharingMutation = (personId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SharingBody) => endpoints.setPersonSharing(apiClient, personId, body),
    onSuccess: (sharing: PersonSharing) => {
      queryClient.setQueryData(albumKeys.personSharing(personId), sharing);
      return queryClient.invalidateQueries({ queryKey: albumKeys.personSharingPending(personId) });
    },
  });
};

/** Approve or keep back photos of the shared person. */
export const useReviewPersonSharingMutation = (personId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ approve, decline }: { approve: string[]; decline: string[] }) =>
      endpoints.reviewPersonSharing(apiClient, personId, approve, decline),
    onSuccess: (sharing: PersonSharing) => {
      queryClient.setQueryData(albumKeys.personSharing(personId), sharing);
      return queryClient.invalidateQueries({ queryKey: albumKeys.personSharingPending(personId) });
    },
  });
};
