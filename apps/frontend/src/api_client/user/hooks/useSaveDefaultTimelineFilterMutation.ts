import { useMutation } from "@tanstack/react-query";
import type { TimelineFilter } from "../../../components/photolist/timelineFilter";
import { SHOW_EVERYTHING } from "../../../components/photolist/timelineFilter";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { User } from "../types";
import { UserSelfDetailsQueryKeys } from "./useFetchUserSelfDetailsQuery";

type SaveDefaultTimelineFilterRequest = {
  userId: number;
  filter: TimelineFilter;
};

// Only the keys that narrow the timeline are saved, so "show everything" is
// stored as {}, which is what a user who never saved a default has.
export function compactTimelineFilter(filter: TimelineFilter): User["default_timeline_filter"] {
  const saved: User["default_timeline_filter"] = {};
  if (filter.media !== SHOW_EVERYTHING.media) saved.media = filter.media;
  if (filter.hide_screenshots) saved.hide_screenshots = true;
  if (filter.hide_documents) saved.hide_documents = true;
  if (filter.favorites) saved.favorites = true;
  return saved;
}

// Saves the timeline's default filter, sending only that field. Not
// useUpdateUserMutation: that one toasts "user updated" and refetches the user
// list and Nextcloud folders, and would leave the old default in the cache
// until its refetch lands, so the timeline would flip back for a moment.
export const useSaveDefaultTimelineFilterMutation = () =>
  useMutation({
    mutationFn: async ({ userId, filter }: SaveDefaultTimelineFilterRequest) => {
      const response = await fetchClient.patch(`/user/${userId}/`, {
        default_timeline_filter: compactTimelineFilter(filter),
      });
      return parseWithNotification(User, response, "Failed to parse update user response");
    },
    onSuccess: user => {
      // Put the new default in place before anything refetches, so the
      // timeline never resolves its filter against the old one in between.
      queryClient.setQueriesData({ queryKey: [...UserSelfDetailsQueryKeys] }, (old: User | undefined) =>
        old?.id === user.id ? user : old
      );
      // The timeline sends its resolved filter in full, and saving does not
      // change what is on screen, so the date albums stay as they are.
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
    },
    onError: () => {
      notification.requestFailed(i18n.t("timelinefilter.save"), i18n.t("timelinefilter.savefailed"));
    },
  });
