import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type UseFetchPublicPhotoDetailQueryParams = {
  slug: string;
  photoId: string;
  enabled?: boolean;
};

export const useFetchPublicPhotoDetailQuery = ({
  slug,
  photoId,
  enabled = true,
}: UseFetchPublicPhotoDetailQueryParams) =>
  useQuery({
    queryKey: photoKeys.publicDetail(slug, photoId),
    queryFn: () => endpoints.fetchPublicAlbumPhoto(apiClient, slug, photoId),
    enabled: enabled && !!slug && !!photoId,
  });
