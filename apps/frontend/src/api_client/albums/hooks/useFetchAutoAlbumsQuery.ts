import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { FetchAutoAlbumsListResponse } from "../types";

export const AutoAlbumsQueryKeys = ["autoAlbums"] as const;

const fetchAutoAlbums = () =>
  fetchClient
    .get("/albums/auto/list/")
    .then(
      response => parseWithNotification(FetchAutoAlbumsListResponse, response, "Failed to parse auto albums").results
    );

export const useFetchAutoAlbumsQuery = () =>
  useQuery({
    queryKey: ["autoAlbums"],
    queryFn: fetchAutoAlbums,
  });
