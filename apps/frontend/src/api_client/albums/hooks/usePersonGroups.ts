import { albumKeys, endpoints, faceKeys } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** The user's groups of people (#1126), by name, each with its person count. */
export const useFetchPersonGroupsQuery = () =>
  useQuery({
    queryKey: albumKeys.personGroups(),
    queryFn: () => endpoints.fetchPersonGroups(apiClient),
  });

/** Create a group; answers it, so a caller can put a person in it right away. */
export const useCreatePersonGroupMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (name: string) => endpoints.createPersonGroup(apiClient, name),
    onSuccess: ({ name }) => {
      notification.createPersonGroup(name);
      return queryClient.invalidateQueries({ queryKey: albumKeys.personGroups() });
    },
  });
};

type RenamePersonGroupParams = { id: number; name: string; newName: string };

export const useRenamePersonGroupMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id, newName }: RenamePersonGroupParams) => endpoints.renamePersonGroup(apiClient, id, newName),
    onSuccess: (_, { name, newName }) => {
      notification.renamePersonGroup(name, newName);
      return queryClient.invalidateQueries({ queryKey: albumKeys.personGroups() });
    },
  });
};

type DeletePersonGroupParams = { id: number; name: string };

/** Delete a group; its people stay, so the people lists lose its id. */
export const useDeletePersonGroupMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id }: DeletePersonGroupParams) => endpoints.deletePersonGroup(apiClient, id),
    onSuccess: (_, { name }) => {
      notification.deletePersonGroup(name);
      // The people lists hold the groups too (albumKeys.personGroups is under peopleAlbums)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() }),
        queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() }),
      ]);
    },
  });
};

type SetPersonGroupsParams = { personId: string; groupIds: number[] };

/** Put a person in exactly these groups: the people lists, the counts and the face dashboard follow. */
export const useSetPersonGroupsMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ personId, groupIds }: SetPersonGroupsParams) =>
      endpoints.setPersonGroups(apiClient, personId, groupIds),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() }),
        queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() }),
      ]),
  });
};
