import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys, photoKeys } from "../keys";

const StatusResponse = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponse>;

export const useSavePhotoCaptionMutation = () =>
  useMutation({
    mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
      const response = await apiClient.post(`/photosedit/savecaption/`, { image_hash: id, caption });
      parseWithNotification(StatusResponse, response, "Failed to parse save photo caption response");
      notification.savePhotoCaptions();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: photoKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("search") });
    },
  });
