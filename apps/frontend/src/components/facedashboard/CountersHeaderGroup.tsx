import { Group, Text } from "@mantine/core";
import { t } from "i18next";
import React, { useEffect, useState } from "react";
import { useAppSelector } from "../../store/store";

type Props = {
  activeTab: number;
};

export function CountersHeaderGroup ({activeTab}: Props) {
  const { inferredFacesList, labeledFacesList } = useAppSelector(
    store => store.face,
    (prev, next) => {
      return prev.inferredFacesList === next.inferredFacesList && prev.labeledFacesList === next.labeledFacesList;
    }
  );

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
    setLabeledUnknownFacesCount(labeledFacesList.map(g => g.kind === "UNKNOWN" ? g.face_count : 0).reduce((a, b) => a + b, 0))
  }, [labeledFacesList]);

  useEffect(() => {
    const assumedFacesList= inferredFacesList.filter(g => g.kind === "");
    setInferredAssumedPersonsCount(assumedFacesList.length); 
    setInferredAssumedFacesCount(assumedFacesList.map(g => g.face_count).reduce((a, b) => a + b, 0));
    const clusteredFacesList= inferredFacesList.filter(g => g.kind === "CLUSTER");
    setInferredClustersCount(clusteredFacesList.length); 
    setInferredClusteredFacesCount(clusteredFacesList.map(g => g.face_count).reduce((a, b) => a + b, 0));
    setInferredUnknownFacesCount(inferredFacesList.map(g => g.kind === "UNKNOWN" ? g.face_count : 0).reduce((a, b) => a + b, 0))
  }, [inferredFacesList]);

  return (
    <Group>
    {activeTab === 0 && (
      <Text align="left" color="dimmed">
        {`${t("facesdashboard.personscounter", {count: labeledPersonsCount})}`}
        {` (${t("facesdashboard.facescounter", {count: labeledFacesCount})})`}
        {labeledUnknownFacesCount !== 0 &&
          ` - ${t("facesdashboard.unknownfacescounter", {count: labeledUnknownFacesCount})}`
        }
      </Text>
    )}
    {activeTab === 1 && (
      <Text align="left" color="dimmed">
        {`${t("facesdashboard.assumedpersonscounter", {count: inferredAssumedPersonsCount})}`}
        {` (${t("facesdashboard.facescounter", {count: inferredAssumedFacesCount})})`}
        {` - ${t("facesdashboard.clusterscounter", {count: inferredClustersCount})}`}
        {` (${t("facesdashboard.facescounter", {count: inferredClusteredFacesCount})})`}
        {inferredUnknownFacesCount !== 0 &&
          ` - ${t("facesdashboard.unknownfacescounter", {count: inferredUnknownFacesCount})}`
        }
      </Text>
    )}
    </Group>
  );
}