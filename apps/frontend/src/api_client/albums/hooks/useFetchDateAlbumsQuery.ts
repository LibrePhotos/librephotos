import { useQuery } from "@tanstack/react-query";
import { type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { addTempElementsToGroups } from "../../../util/util";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { Photoset } from "../../photos/types";
import { FetchDateAlbumsListResponse } from "../types";

export const DateAlbumsQueryKeys = ["dateAlbums"] as const;

// The backend's boolean date-album filter params: each is either the string
// "true" or omitted (undefined).
export type DateAlbumFilterParams = {
  favorite?: "true";
  public?: "true";
  hidden?: "true";
  in_trashcan?: "true";
  photo?: "true";
  video?: "true";
  is_screenshot?: "true";
};

// Maps the active Photoset plus an optional, independent media-type filter onto
// the backend's boolean query params. photosetType picks the surface (favorites,
// videos, screenshots, ...); mediaType is the per-view All/Photos/Videos/
// Screenshots toggle that layers on top (e.g. a person album filtered to
// screenshots), so photo/video/is_screenshot react to either source.
export function buildDateAlbumFilterParams(photosetType: Photoset, mediaType?: MediaType): DateAlbumFilterParams {
  return {
    favorite: Photoset.FAVORITES === photosetType ? "true" : undefined,
    public: Photoset.PUBLIC === photosetType ? "true" : undefined,
    hidden: Photoset.HIDDEN === photosetType ? "true" : undefined,
    in_trashcan: Photoset.IN_TRASHCAN === photosetType ? "true" : undefined,
    photo: Photoset.PHOTOS === photosetType || mediaType === "photos" ? "true" : undefined,
    video: Photoset.VIDEOS === photosetType || mediaType === "videos" ? "true" : undefined,
    is_screenshot: Photoset.SCREENSHOTS === photosetType || mediaType === "screenshots" ? "true" : undefined,
  };
}

// Define the parameter types for the queries
type AlbumDateListOptions = {
  photosetType: Photoset;
  person_id?: number;
  username?: string;
  folder?: string;
  // Optional media-type filter, independent of photosetType (e.g. a person
  // album filtered to videos). Combines with photosetType for photo/video.
  mediaType?: MediaType;
};

// Fetch date albums
export const useFetchDateAlbumsQuery = (options: AlbumDateListOptions) =>
  useQuery({
    queryKey: [
      ...DateAlbumsQueryKeys,
      options.photosetType,
      options.person_id,
      options.username,
      options.folder,
      options.mediaType ?? "all",
    ],
    queryFn: async () => {
      const params = {
        ...buildDateAlbumFilterParams(options.photosetType, options.mediaType),
        person: options.person_id,
        username: options.username?.toLowerCase(),
        folder: options.folder,
      };

      const response = await fetchClient.get(
        `/albums/date/list/?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
        ).toString()}`
      );

      const parsed = parseWithNotification(FetchDateAlbumsListResponse, response, "Failed to load photo groups");
      const { results } = parsed;

      addTempElementsToGroups(results);
      return results;
    },
  });
