import type { FaceAnalysisMethod, IncompletePersonFaceListRequest } from "@librephotos/api-client";
import { faceKeys } from "@librephotos/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { queryClient } from "../../../api_client/api";
import type { CompletePersonFaceList } from "../../../api_client/faces";
import { fetchFaces, useFetchIncompleteFacesQuery } from "../../../api_client/faces";
import { isUnknownGroup, type FacesPersonOrder, type FacesRouteOrder, type FacesTab } from "../facesTab";
import { orderPeople } from "../personOrder";

/** Page size of the backend's face list endpoint (RegularResultsSetPagination). */
export const PAGE_SIZE = 100;

/** A page of a person's faces the grid shows: of the suggested, the labelled or the deleted faces. */
export type FaceGroupPage = {
  page: number;
  person: number;
  inferred: boolean;
  method: FaceAnalysisMethod;
  /** The Deleted tab's page (#127). */
  deleted: boolean;
};

/** The people list behind each kind of tab: labelled, suggested and deleted faces. */
type FacesListRequests = Readonly<Record<"labeled" | "inferred" | "deleted", IncompletePersonFaceListRequest>>;

/** The order the backend sorts by: the dashboard's older "person" order sorts by date. */
const serverOrder = (orderBy: FacesRouteOrder) => (orderBy === "person" ? "date" : orderBy);

// Custom hook to manage face data fetching
export function useFaceDataFetching(
  groups: FaceGroupPage[],
  activeTab: FacesTab,
  analysisMethod: FaceAnalysisMethod,
  orderBy: FacesRouteOrder,
  minConfidence: number,
  personOrder: FacesPersonOrder,
  /** Only the people of this group (#1126); the Unknown tab is not narrowed. */
  group: number | undefined
) {
  // Create params objects for API calls. Memoized: they key the cache entries the
  // page loader below reads and writes, and a fresh object on every render would
  // restart that loader on every render.
  const params = useMemo(
    (): FacesListRequests => ({
      labeled: { inferred: false, orderBy: serverOrder(orderBy), group },
      inferred: {
        inferred: true,
        method: analysisMethod,
        orderBy: serverOrder(orderBy),
        minConfidence,
        group,
      },
      // Every deleted face, by the person it had (#127)
      deleted: { inferred: false, orderBy: serverOrder(orderBy), deleted: true, group },
    }),
    [orderBy, analysisMethod, minConfidence, group]
  );

  // Fetch data for both labeled and inferred categories
  const { data: labeledFacesListUnfiltered = [], isFetching: fetchingLabeledFacesList } = useFetchIncompleteFacesQuery(
    params.labeled
  );

  const { data: inferredFacesListUnfiltered = [], isFetching: fetchingInferredFacesList } =
    useFetchIncompleteFacesQuery(params.inferred);

  const { data: deletedFacesListUnfiltered = [], isFetching: fetchingDeletedFacesList } = useFetchIncompleteFacesQuery(
    params.deleted
  );

  // Training, an added face or a person's rename invalidates the incomplete lists (a face
  // edit does not, see faceListCache), and the refetch replaces every face with a placeholder again. Nothing else tells the grid to reload the
  // pages it is showing, so the cells it already asked for would stay blank until
  // the user scrolls. Count the refetches and reload the visible pages on each one.
  const [listRefreshCount, setListRefreshCount] = useState(0);
  const wasFetchingLists = useRef(false);
  const isFetchingLists = fetchingLabeledFacesList || fetchingInferredFacesList || fetchingDeletedFacesList;
  useEffect(() => {
    if (wasFetchingLists.current && !isFetchingLists) {
      setListRefreshCount(count => count + 1);
    }
    wasFetchingLists.current = isFetchingLists;
  }, [isFetchingLists]);

  // Filter data by category - MEMOIZED to prevent recalculation on every render. The people are
  // ordered on copies (#764): the cached lists keep the server's name order.
  const lists = useMemo(
    () => ({
      unknown: inferredFacesListUnfiltered.filter(isUnknownGroup),
      inferred: orderPeople(
        inferredFacesListUnfiltered.filter(person => !isUnknownGroup(person)),
        personOrder
      ),
      labeled: orderPeople(
        labeledFacesListUnfiltered.filter(person => !isUnknownGroup(person)),
        personOrder
      ),
      // The deleted faces of no one stay last, as the server sends them
      deleted: [
        ...orderPeople(
          deletedFacesListUnfiltered.filter(person => !isUnknownGroup(person)),
          personOrder
        ),
        ...deletedFacesListUnfiltered.filter(isUnknownGroup),
      ],
    }),
    [inferredFacesListUnfiltered, labeledFacesListUnfiltered, deletedFacesListUnfiltered, personOrder]
  );

  // Changes when the slots on the active tab change: a refetch (every face a placeholder again),
  // or a face edit (people and their face counts), but not when a page of faces lands. The grid
  // then asks again for the pages on screen, which the range it last reported may not hold.
  const activeList = lists[activeTab];
  const listsVersion = useMemo(
    () => `${listRefreshCount}|${activeList.map(person => `${person.id}:${person.faces.length}`).join(",")}`,
    [listRefreshCount, activeList]
  );

  // Create hash mapping based on active tab - MEMOIZED
  const idx2hash = useMemo(() => {
    // face.photo is the UUID (Photo's primary key after migration 0099)
    // face.photo_image_hash is the actual image hash needed for media URLs
    return (
      lists[activeTab]
        .flatMap(person => person.faces)
        // Placeholders keep their place with "" (the server never sends a face without its photo).
        .map(face => ({ id: face.photo ?? "", image_hash: face.photo_image_hash || (face.photo ?? "") }))
    );
  }, [lists, activeTab]);

  // Fetch detailed face data when groups change
  useEffect(() => {
    if (!groups.length) return undefined;

    let cancelled = false;

    (async () => {
      // TODO(sickelap): find a better way to do this
      for (const element of groups) {
        if (cancelled) return;

        const incompleteParams = incompleteParamsOf(element, params);
        const incompleteKey = faceKeys.incompleteList(incompleteParams);
        const person = queryClient
          .getQueryData<CompletePersonFaceList>(incompleteKey)
          ?.find(entry => entry.id === element.person);

        // The grid works the page numbers out from the face counts it was last
        // given. Moving faces back to "Unknown - Other" shrinks those counts, so
        // a page that was still queued can now sit past the end of the person, or
        // name a person that has no faces left at all. The backend answers that
        // with 404 "Invalid page", which the dashboard shows as an error.
        const pageStart = (element.page - 1) * PAGE_SIZE;
        if (!person || pageStart >= person.faces.length) {
          continue;
        }
        // Loaded already: a face edit keeps the faces it did not touch (faceListCache)
        if (!person.faces.slice(pageStart, pageStart + PAGE_SIZE).some(face => face.isTemp)) {
          continue;
        }
        // A face edit while the page loads moves the faces after it: the answer no longer fits
        const faceCountAsked = person.faces.length;

        try {
          const queryParams = {
            person: element.person || 0,
            page: element.page,
            inferred: element.inferred,
            orderBy: serverOrder(orderBy),
            minConfidence: element.inferred ? minConfidence : undefined,
            method: element.inferred ? element.method : undefined,
            deleted: element.deleted || undefined,
          };

          // Fetch face data
          // TODO(sickelap): related to the above. optimize by using prefetchQuery and checking if data is already in cache
          const data = await queryClient.fetchQuery({
            queryKey: faceKeys.personFacePage(queryParams),
            queryFn: () => fetchFaces(queryParams),
          });

          if (cancelled) return;

          // Update cache with fetched data
          const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(incompleteKey);

          const current = incompleteData?.find(entry => entry.id === element.person);
          if (incompleteData && current && current.faces.length === faceCountAsked) {
            const faces = current.faces.slice();
            data.slice(0, faces.length - pageStart).forEach((face, offset) => {
              faces[pageStart + offset] = { ...face, person: element.person };
            });
            queryClient.setQueryData(
              incompleteKey,
              incompleteData.map(entry => (entry === current ? { ...entry, faces } : entry))
            );
          }
        } catch (error) {
          console.error("Error fetching faces:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groups, orderBy, minConfidence, analysisMethod, params, listRefreshCount]);

  return {
    lists,
    fetchingLabeledFacesList,
    fetchingInferredFacesList,
    fetchingDeletedFacesList,
    idx2hash,
    params,
    listsVersion,
  };
}

/** The people list a page belongs to: the deleted, the suggested or the labelled faces. */
function incompleteParamsOf(page: FaceGroupPage, params: FacesListRequests): IncompletePersonFaceListRequest {
  if (page.deleted) return params.deleted;
  return page.inferred ? params.inferred : params.labeled;
}
