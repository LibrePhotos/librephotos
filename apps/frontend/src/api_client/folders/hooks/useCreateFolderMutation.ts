import { endpoints, folderKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

type NewFolder = Readonly<{ parent: string; name: string }>;

/**
 * Admin: make a folder inside the data root from the folder picker (#2035). Answers the folder and
 * its parent listed again, which the picker merges into its tree.
 */
export const useCreateFolderMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ parent, name }: NewFolder) => endpoints.createFolder(apiClient, parent, name),
    // Every cached listing may hold the parent: list them again when next shown.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: folderKeys.all }),
  });
};
