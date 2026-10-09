import { useMutation } from "@tanstack/react-query";
import type { TimelineFilter } from "../../../components/photolist/timelineFilter";
import { SHOW_EVERYTHING } from "../../../components/photolist/timelineFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { User } from "../types";
import { UserSelfDetailsQueryKeys } from "./useFetchUserSelfDetailsQuery";

type SaveDefaultTimelineFilterRequest = {
  userId: number;
  filter: TimelineFilter;
};

// Only the keys that narrow the timeline are saved, so "show everything" is
// stored as {}, the same as never having saved a default.
export function compactTimelineFilter(filter: TimelineFilter): User["default_timeline_filter"] {
  const saved: User["default_timeline_filter"] = {};
  if (filter.media !== SHOW_EVERYTHING.media) saved.media = filter.media;
  if (filter.hide_screenshots) saved.hide_screenshots = true;
  if (filter.hide_documents) saved.hide_documents = true;
  if (filter.favorites) saved.favorites = true;
  return saved;
}

// Saves the timeline's default filter. The body carries only that field: the
// whole user object would send avatar back as a URL, which the server refuses
// with a 400 for anyone who has an avatar (issue #2153).
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
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    },
  });
