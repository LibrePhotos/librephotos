import { useQuery } from "@tanstack/react-query";
import { mediaTypeToParams, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { UserAlbum } from "../types";

export const UserAlbumQueryKeys = ["userAlbum"] as const;

export const useFetchUserAlbumQuery = (
  id: string,
  opts?: { public?: boolean; username?: string; mediaType?: MediaType }
) =>
  useQuery({
    queryKey: [...UserAlbumQueryKeys, id, opts?.public ?? false, opts?.username ?? "", opts?.mediaType ?? "all"],
    enabled: Boolean(id),
    queryFn: async () => {
      const query = new URLSearchParams(mediaTypeToParams(opts?.mediaType));
      if (opts?.public) query.set("public", "true");
      if (opts?.username) query.set("username", opts.username);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await fetchClient.get(`/albums/user/${id}/${suffix}`);
      return parseWithNotification(UserAlbum, response, "Failed to parse user album");
    },
  });
