import { useMutation } from "@tanstack/react-query";
import i18n from "../../../i18n";
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
        i18n.t("services.actionfailed"),
        i18n.t(variables.action === "start" ? "services.startfailed" : "services.stopfailed", {
          name: i18n.t(`services.label_${variables.serviceName}`, variables.serviceName),
        })
      );
    },
  });
