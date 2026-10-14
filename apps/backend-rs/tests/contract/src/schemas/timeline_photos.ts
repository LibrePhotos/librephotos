// Schemas of the timeline_photos area that the frontend defines inside hook
// files (which pull in React), copied here verbatim.
import { UserAlbumInfo } from "@librephotos/api-client";
import { z } from "zod";

// apps/frontend/src/api_client/photos/hooks/useFetchPhotoAlbumsQuery.ts
export const PhotoAlbumsResponse = z.object({
  results: UserAlbumInfo.array(),
});
