import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { serverKeys } from "../keys";

const ImageTagResponse = z.object({
  image_tag: z.string(),
  git_hash: z.string(),
});

type ImageTagResponse = z.infer<typeof ImageTagResponse>;

export const useFetchImageTagQuery = () =>
  useQuery({
    queryKey: serverKeys.imageTag(),
    queryFn: async () => {
      const response = await fetchClient.get("/imagetag/");
      return parseWithNotification(ImageTagResponse, response, "Failed to parse image tag");
    },
  });
