import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Re-title every existing event album (/autoalbumtitlegen/; /autoalbumgen/ would
 * only title the albums whose photos changed). The API client already reports a
 * server error, so a failure shows no second toast.
 */
export const useRegenerateEventTitlesMutation = () =>
  useMutation({
    mutationFn: () => startJob(() => endpoints.regenerateEventAlbumTitles(apiClient)),
    onSuccess: start => {
      if (!start.alreadyRunning) {
        notification.regenerateEventAlbums();
      }
    },
  });
