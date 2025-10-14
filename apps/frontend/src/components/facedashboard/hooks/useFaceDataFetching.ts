import { useEffect } from "react";
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
  // Create params objects for API calls
  const params = {
    labeled: { inferred: false, orderBy: orderBy === "person" ? "date" : orderBy },
    inferred: {
      inferred: true,
      method: analysisMethod,
      orderBy: orderBy === "person" ? "date" : orderBy,
      minConfidence,
    },
  };

  // Fetch data for both labeled and inferred categories
  const { data: labeledFacesListUnfiltered = [], isFetching: fetchingLabeledFacesList } = useFetchIncompleteFacesQuery(
    params.labeled
  );

  const { data: inferredFacesListUnfiltered = [], isFetching: fetchingInferredFacesList } =
    useFetchIncompleteFacesQuery(params.inferred);

  // Filter data by category
  const lists = {
    unknown: inferredFacesListUnfiltered.filter(person => person.name === "Unknown - Other"),
    inferred: inferredFacesListUnfiltered.filter(person => person.name !== "Unknown - Other"),
    labeled: labeledFacesListUnfiltered.filter(person => person.name !== "Unknown - Other"),
  };

  function getTabName() {
    if (activeTab === FacesTab.enum.labeled) return "labeled";
    if (activeTab === FacesTab.enum.inferred) return "inferred";
    return "unknown";
  }

  // Create hash mapping based on active tab
  const idx2hash = lists[getTabName()].flatMap(person => person.faces).map(face => ({ id: face.photo }));

  // Fetch detailed face data when groups change
  useEffect(() => {
    if (!groups.length) return;

    (async () => {
      // TODO(sickelap): find a better way to do this
      // eslint-disable-next-line no-restricted-syntax
      for (const element of groups) {
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
            queryKey: [FacesQueryKeys, queryParams],
            queryFn: () => fetchFaces(queryParams),
          });

          // Update cache with fetched data
          const incompleteParams = element.inferred ? params.inferred : params.labeled;
          const incompleteData = queryClient.getQueryData<CompletePersonFaceList>([
            ...IncompleteFacesQueryKeys,
            incompleteParams,
          ]);

          if (incompleteData) {
            queryClient.setQueryData(
              [...IncompleteFacesQueryKeys, incompleteParams],
              incompleteData.map(person =>
                person.id === element.person
                  ? {
                      ...person,
                      faces: person.faces.map((face, idx) => {
                        const dataIndex = idx - (element.page - 1) * 100;
                        return dataIndex >= 0 && dataIndex < data.length
                          ? { ...data[dataIndex], person: element.person }
                          : face;
                      }),
                    }
                  : person
              )
            );
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("Error fetching faces:", error);
        }
      }
    })();
  }, [groups, orderBy, minConfidence, analysisMethod, params.inferred, params.labeled]);

  return {
    lists,
    fetchingLabeledFacesList,
    fetchingInferredFacesList,
    idx2hash,
    params,
  };
}
