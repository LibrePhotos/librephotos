import { endpoints, photoGridKeys, type PigPhoto } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { apiClient } from "../../api";

/** What a "Shared with you" photo grid shows: a place or thing by its title, or a person by id. */
export type SharedGroupRef =
  Readonly<{ kind: "places" | "things"; title: string }> | Readonly<{ kind: "people"; personId: number }>;

type GroupKind = SharedGroupRef["kind"];

const fetchPhotos = (kind: GroupKind, key: string): Promise<PigPhoto[]> =>
  kind === "people"
    ? endpoints.fetchSharedPersonPhotos(apiClient, Number(key))
    : endpoints.fetchSharedGroupPhotos(apiClient, kind, key);

/** The photos shared with me under one place, thing or person, grouped per owner like the Photos tab. */
export const useFetchSharedGroupPhotosQuery = (ref: SharedGroupRef) => {
  const kind = ref.kind;
  const key = ref.kind === "people" ? String(ref.personId) : ref.title;
  return useQuery({
    queryKey: photoGridKeys.sharedWithMeGroup(kind, key),
    queryFn: async () => {
      const results = await fetchPhotos(kind, key);
      return toPairs(groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
    },
    // A 404 means nothing is shared under it any more: asking again will not change that.
    retry: false,
  });
};
