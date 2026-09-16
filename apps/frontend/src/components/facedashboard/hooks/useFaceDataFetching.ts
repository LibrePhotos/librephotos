import { useEffect, useMemo, useRef, useState } from "react";
import { queryClient } from "../../../api_client/api";
import {
  CompletePersonFaceList,
  FaceAnalysisMethod,
  FacesQueryKeys,
  FacesTab,
  fetchFaces,
  IncompleteFacesQueryKeys,
  useFetchIncompleteFacesQuery,
} from "../../../api_client/faces";

type OrderByType = "confidence" | "date" | "person";

/** Page size of the backend's face list endpoint (RegularResultsSetPagination). */
const PAGE_SIZE = 100;

// Custom hook to manage face data fetching
export function useFaceDataFetching(
  groups: Array<{
    page: number;
    person: number;
    inferred: boolean;
    method: FaceAnalysisMethod;
  }>,
  activeTab: FacesTab,
  analysisMethod: FaceAnalysisMethod,
  orderBy: OrderByType,
  minConfidence: number
) {
  // Create params objects for API calls. Memoized: they key the cache entries the
  // page loader below reads and writes, and a fresh object on every render would
  // restart that loader on every render.
  const params = useMemo(
    () => ({
      labeled: { inferred: false, orderBy: orderBy === "person" ? "date" : orderBy },
      inferred: {
        inferred: true,
        method: analysisMethod,
        orderBy: orderBy === "person" ? "date" : orderBy,
        minConfidence,
      },
    }),
    [orderBy, analysisMethod, minConfidence]
  );

  // Fetch data for both labeled and inferred categories
  const { data: labeledFacesListUnfiltered = [], isFetching: fetchingLabeledFacesList } = useFetchIncompleteFacesQuery(
    params.labeled
  );

  const { data: inferredFacesListUnfiltered = [], isFetching: fetchingInferredFacesList } =
    useFetchIncompleteFacesQuery(params.inferred);

  // A tagging mutation invalidates the incomplete lists, and the refetch replaces
  // every face with a placeholder again. Nothing else tells the grid to reload the
  // pages it is showing, so the cells it already asked for would stay blank until
  // the user scrolls. Count the refetches and reload the visible pages on each one.
  const [listRefreshCount, setListRefreshCount] = useState(0);
  const wasFetchingLists = useRef(false);
  const isFetchingLists = fetchingLabeledFacesList || fetchingInferredFacesList;
  useEffect(() => {
    if (wasFetchingLists.current && !isFetchingLists) {
      setListRefreshCount(count => count + 1);
    }
    wasFetchingLists.current = isFetchingLists;
  }, [isFetchingLists]);

  // Filter data by category - MEMOIZED to prevent recalculation on every render
  const lists = useMemo(
    () => ({
      unknown: inferredFacesListUnfiltered.filter(person => person.name === "Unknown - Other"),
      inferred: inferredFacesListUnfiltered.filter(person => person.name !== "Unknown - Other"),
      labeled: labeledFacesListUnfiltered.filter(person => person.name !== "Unknown - Other"),
    }),
    [inferredFacesListUnfiltered, labeledFacesListUnfiltered]
  );

  // Create hash mapping based on active tab - MEMOIZED
  const idx2hash = useMemo(() => {
    const tabName =
      activeTab === FacesTab.enum.labeled ? "labeled" : activeTab === FacesTab.enum.inferred ? "inferred" : "unknown";
    // face.photo is the UUID (Photo's primary key after migration 0099)
    // face.photo_image_hash is the actual image hash needed for media URLs
    return lists[tabName]
      .flatMap(person => person.faces)
      .map(face => ({ id: face.photo, image_hash: face.photo_image_hash || face.photo }));
  }, [lists, activeTab]);

  // Fetch detailed face data when groups change
  useEffect(() => {
    if (!groups.length) return undefined;

    let cancelled = false;

    (async () => {
      // TODO(sickelap): find a better way to do this
      // eslint-disable-next-line no-restricted-syntax
      for (const element of groups) {
        if (cancelled) return;

        const incompleteParams = element.inferred ? params.inferred : params.labeled;
        const incompleteKey = [...IncompleteFacesQueryKeys, incompleteParams];
        const person = queryClient
          .getQueryData<CompletePersonFaceList>(incompleteKey)
          ?.find(entry => entry.id === element.person);

        // The grid works the page numbers out from the face counts it was last
        // given. Moving faces back to "Unknown - Other" shrinks those counts, so
        // a page that was still queued can now sit past the end of the person, or
        // name a person that has no faces left at all. The backend answers that
        // with 404 "Invalid page", which the dashboard shows as an error.
        if (!person || (element.page - 1) * PAGE_SIZE >= person.faces.length) {
          // eslint-disable-next-line no-continue
          continue;
        }

        try {
          const queryParams = {
            person: element.person || 0,
            page: element.page,
            inferred: element.inferred,
            orderBy: orderBy === "person" ? "date" : orderBy,
            minConfidence: element.inferred ? minConfidence : undefined,
            method: element.inferred ? element.method : undefined,
          };

          // Fetch face data
          // TODO(sickelap): related to the above. optimize by using prefetchQuery and checking if data is already in cache
          // eslint-disable-next-line no-await-in-loop
          const data = await queryClient.fetchQuery({
            queryKey: [...FacesQueryKeys, queryParams],
            queryFn: () => fetchFaces(queryParams),
          });

          if (cancelled) return;

          // Update cache with fetched data
          const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(incompleteKey);

          if (incompleteData) {
            queryClient.setQueryData(
              incompleteKey,
              incompleteData.map(entry =>
                entry.id === element.person
                  ? {
                      ...entry,
                      faces: entry.faces.map((face, idx) => {
                        const dataIndex = idx - (element.page - 1) * PAGE_SIZE;
                        return dataIndex >= 0 && dataIndex < data.length
                          ? { ...data[dataIndex], person: element.person }
                          : face;
                      }),
                    }
                  : entry
              )
            );
          }
        } catch (error) {
          // eslint-disable-next-line no-console
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
    idx2hash,
    params,
  };
}
