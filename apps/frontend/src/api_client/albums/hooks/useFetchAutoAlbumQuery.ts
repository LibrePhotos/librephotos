import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { AutoAlbum } from "../types";

export const AutoAlbumQueryKeys = ["autoAlbum"] as const;

export const useFetchAutoAlbumQuery = (id: string) =>
  useQuery({
    queryKey: [...AutoAlbumQueryKeys, id],
    queryFn: () =>
      fetchClient
        .get<AutoAlbum>(`/albums/auto/${id}/`)
        .then(response => parseWithNotification(AutoAlbum, response, "Failed to parse auto album")),
    enabled: !!id,
  });
