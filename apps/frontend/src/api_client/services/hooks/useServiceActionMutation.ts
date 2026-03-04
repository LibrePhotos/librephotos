import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { ServiceHealthQueryKeys } from "./useServicesQuery";

type ServiceAction = {
  serviceName: string;
  action: "start" | "stop";
};

export const useServiceActionMutation = () =>
  useMutation({
    mutationFn: async ({ serviceName, action }: ServiceAction) => {
      const response = await fetchClient.post<{ message: string }>(`/services/${serviceName}/${action}/`);
      return response;
    },
    onSuccess: data => {
      notification.serviceActionSuccess(data.message);
      queryClient.invalidateQueries({ queryKey: [...ServiceHealthQueryKeys] });
    },
    onError: (_error, variables) => {
      notification.requestFailed(
        "Service Action Failed",
        `Failed to ${variables.action} service ${variables.serviceName}`
      );
    },
  });
