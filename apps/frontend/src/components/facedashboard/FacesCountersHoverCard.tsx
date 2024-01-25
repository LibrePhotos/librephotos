import { HoverCard, Stack, Text } from "@mantine/core";
import { t } from "i18next";
import React, { useEffect, useState } from "react";

import { FacesTab } from "../../store/faces/facesActions.types";
import type { IFacesTab } from "../../store/faces/facesActions.types";
import { useAppSelector } from "../../store/store";

type Props = Readonly<{
  tab: IFacesTab;
  children: React.ReactNode;
}>;

export function FacesCountersHoverCard({ tab, children }: Props) {
  const { inferredFacesList, labeledFacesList } = useAppSelector(store => store.face);

  const [labeledPersonsCount, setLabeledPersonsCount] = useState(0);
  const [labeledFacesCount, setLabeledFacesCount] = useState(0);
  const [labeledUnknownFacesCount, setLabeledUnknownFacesCount] = useState(0);
  const [inferredAssumedPersonsCount, setInferredAssumedPersonsCount] = useState(0);
  const [inferredAssumedFacesCount, setInferredAssumedFacesCount] = useState(0);
  const [inferredClustersCount, setInferredClustersCount] = useState(0);
  const [inferredClusteredFacesCount, setInferredClusteredFacesCount] = useState(0);
  const [inferredUnknownFacesCount, setInferredUnknownFacesCount] = useState(0);

  useEffect(() => {
    const labeledFacesListWithoutUnknown = labeledFacesList.filter(g => g.kind !== "UNKNOWN");
    setLabeledPersonsCount(labeledFacesListWithoutUnknown.length);
    setLabeledFacesCount(labeledFacesListWithoutUnknown.map(g => g.face_count).reduce((a, b) => a + b, 0));
    setLabeledUnknownFacesCount(
      labeledFacesList.map(g => (g.kind === "UNKNOWN" ? g.face_count : 0)).reduce((a, b) => a + b, 0)
    );
  }, [labeledFacesList]);

  useEffect(() => {
    const assumedFacesList = inferredFacesList.filter(g => g.kind === "USER");
    setInferredAssumedPersonsCount(assumedFacesList.length);
    setInferredAssumedFacesCount(assumedFacesList.map(g => g.face_count).reduce((a, b) => a + b, 0));
    const clusteredFacesList = inferredFacesList.filter(g => g.kind === "CLUSTER");
    setInferredClustersCount(clusteredFacesList.length);
    setInferredClusteredFacesCount(clusteredFacesList.map(g => g.face_count).reduce((a, b) => a + b, 0));
    setInferredUnknownFacesCount(
      inferredFacesList.map(g => (g.kind === "UNKNOWN" ? g.face_count : 0)).reduce((a, b) => a + b, 0)
    );
  }, [inferredFacesList]);

  const getLabeledCounters = () => (
    <Stack>
      <Text size="sm">
        {`${t("facesdashboard.personscounter", { count: labeledPersonsCount })}`}{" "}
        {`(${t("facesdashboard.facescounter", { count: labeledFacesCount })})`}
      </Text>
      {labeledUnknownFacesCount !== 0 && (
        <Text size="sm">{`${t("facesdashboard.unknownfacescounter", { count: labeledUnknownFacesCount })}`}</Text>
      )}
    </Stack>
  );

  const getInferredCounters = () => (
    <Stack>
      <Text size="sm">
        {`${t("facesdashboard.assumedpersonscounter", { count: inferredAssumedPersonsCount })}`}{" "}
        {`(${t("facesdashboard.facescounter", { count: inferredAssumedFacesCount })})`}
      </Text>
      <Text size="sm">
        {`${t("facesdashboard.clusterscounter", { count: inferredClustersCount })}`}{" "}
        {`(${t("facesdashboard.facescounter", { count: inferredClusteredFacesCount })})`}
      </Text>
      {inferredUnknownFacesCount !== 0 && (
        <Text size="sm">{`${t("facesdashboard.unknownfacescounter", { count: inferredUnknownFacesCount })}`}</Text>
      )}
    </Stack>
  );

  const getCountersContent = () => {
    if (tab === FacesTab.enum.labeled) return getLabeledCounters();
    if (tab === FacesTab.enum.inferred) return getInferredCounters();
    return null;
  };

  return (
    <HoverCard shadow="md" openDelay={500}>
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>{getCountersContent()}</HoverCard.Dropdown>
    </HoverCard>
  );
}
