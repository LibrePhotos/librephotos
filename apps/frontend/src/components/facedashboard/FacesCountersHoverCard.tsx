import { HoverCard, Stack, Text } from "@mantine/core";
import { t } from "i18next";
import React from "react";

import { FacesTab } from "../../api_client/faces";
import { useFetchIncompleteFacesQuery } from "../../api_client/faces/hooks/useFetchIncompleteFacesQuery";
import { FaceAnalysisMethod } from "../../api_client/faces/types";

type Props = Readonly<{
  tab: FacesTab;
  children: React.ReactNode;
}>;

export function FacesCountersHoverCard({ tab, children }: Props) {
  const { data: facesList = [] } = useFetchIncompleteFacesQuery({
    inferred: tab === FacesTab.enum.inferred || tab === FacesTab.enum.unknown,
    orderBy: "date",
    method: FaceAnalysisMethod.enum.clustering
  });

  const getFilteredPersons = () => {
    if (tab === FacesTab.enum.labeled) {
      return facesList.filter(person => person.name !== "Unknown - Other");
    } else if (tab === FacesTab.enum.inferred) {
      return facesList.filter(person => person.name !== "Unknown - Other");
    } else {
      return facesList.filter(person => person.name === "Unknown - Other");
    }
  };

  const getFaceCount = () => {
    return getFilteredPersons().reduce((sum, person) => sum + person.faces.length, 0);
  };

  const getPersonCount = () => {
    return getFilteredPersons().length;
  };

  const getLabeledCounters = () => {
    const labeledPersons = facesList.filter(person => person.name !== "Unknown - Other");
    const labeledPersonsCount = labeledPersons.length;
    const labeledFacesCount = labeledPersons.reduce((sum, person) => sum + person.faces.length, 0);

    return (
      <Stack>
        <Text size="sm">
          {`${t("facesdashboard.personscounter", { count: labeledPersonsCount })}`}{" "}
          {`(${t("facesdashboard.facescounter", { count: labeledFacesCount })})`}
        </Text>
      </Stack>
    );
  };

  const getInferredCounters = () => {
    const inferredPersons = facesList.filter(person => person.name !== "Unknown - Other");
    const inferredAssumedPersonsCount = inferredPersons.length;
    const inferredAssumedFacesCount = inferredPersons.reduce((sum, person) => sum + person.faces.length, 0);
    const inferredClustersCount = facesList.length;
    const inferredClusteredFacesCount = facesList.reduce((sum, person) => sum + person.faces.length, 0);

    return (
      <Stack>
        <Text size="sm">
          {`${t("facesdashboard.assumedpersonscounter", { count: inferredAssumedPersonsCount })}`}{" "}
          {`(${t("facesdashboard.facescounter", { count: inferredAssumedFacesCount })})`}
        </Text>
        <Text size="sm">
          {`${t("facesdashboard.clusterscounter", { count: inferredClustersCount })}`}{" "}
          {`(${t("facesdashboard.facescounter", { count: inferredClusteredFacesCount })})`}
        </Text>
      </Stack>
    );
  };

  const getUnknownCounters = () => {
    const unknownPersons = facesList.filter(person => person.name === "Unknown - Other");
    const unknownFacesCount = unknownPersons.reduce((sum, person) => sum + person.faces.length, 0);

    return (
      <Stack>
        <Text size="sm">
          {`${t("facesdashboard.unknownfacescounter", { count: unknownFacesCount })}`}
        </Text>
      </Stack>
    );
  };

  const getCountersContent = () => {
    if (tab === FacesTab.enum.labeled) return getLabeledCounters();
    if (tab === FacesTab.enum.inferred) return getInferredCounters();
    if (tab === FacesTab.enum.unknown) return getUnknownCounters();
    return null;
  };

  return (
    <HoverCard shadow="md" openDelay={500}>
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>{getCountersContent()}</HoverCard.Dropdown>
    </HoverCard>
  );
}
