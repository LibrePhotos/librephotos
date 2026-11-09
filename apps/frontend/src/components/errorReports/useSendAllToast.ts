import type { ErrorReportSendAll } from "@librephotos/api-client";
import { useTranslation } from "react-i18next";
import { notification } from "../../service/notifications";

/** The `mutate` options of Send all that say how many reports went (#2938). */
export function useSendAllToast() {
  const { t } = useTranslation();
  return {
    onSuccess: ({ sent, failed }: ErrorReportSendAll) => {
      const message = t("errorreports.send_all_toast", { sent, failed });
      if (failed > 0) {
        notification.warning(message);
      } else {
        notification.success(message);
      }
    },
  };
}
