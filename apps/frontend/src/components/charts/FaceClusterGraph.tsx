import { Image, Loader, Stack, Text, Title } from "@mantine/core";
import React, { useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Hint, HorizontalGridLines, MarkSeries, VerticalGridLines, XYPlot } from "react-vis";

import { serverAddress } from "../../api_client/apiClient";
import { useClusterFacesQuery } from "../../api_client/faces/hooks/useClusterFacesQuery";

type Props = Readonly<{
  height: number;
}>;

export function FaceClusterGraph({ height }: Props) {
  const [hintValue, setHintValue] = useState<any>({} as any);
  const { t } = useTranslation();
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => {
      observe();
    },
  });
  const { data: facesVis, isFetching: clustering, isSuccess: clustered } = useClusterFacesQuery();

  const personNames = facesVis?.data ? [...new Set(facesVis.data.map((el: any) => el.person_name))] : [];

  const mappedScatter = personNames.map(name => {
    const thisPersonVis = facesVis?.data?.filter((el: any) => name === el.person_name) ?? [];
    const thisPersonData = thisPersonVis.map((el: any) => ({
      x: el.value.x,
      y: el.value.y,
      size: el.value.size,
      name: el.person_name,
      color: el.color,
      face_url: el.face_url,
      photo: el.photo,
    }));
    return (
      <MarkSeries
        colorType="literal"
        key={`cluster-marker-${name}`}
        animation
        onValueClick={d => {
          setHintValue(d);
        }}
        data={thisPersonData}
      />
    );
    // @ts-ignore
  }, this);
  if (clustered) {
    return (
      <Stack ref={observeChange}>
        <div>
          <Title order={3}> {t("facecluster")} </Title>
          <Text c="dimmed">{t("faceclusterexplanation")}</Text>
        </div>
        <XYPlot width={width - 30} height={height}>
          <HorizontalGridLines />
          <VerticalGridLines />
          {mappedScatter}
          {hintValue.name && (
            <Hint value={hintValue}>
              <Text>
                {hintValue.name}
                <Image radius="xl" height={70} width={70} src={serverAddress + hintValue.face_url} />
              </Text>
            </Hint>
          )}
        </XYPlot>
      </Stack>
    );
  }
  if (clustering) {
    return (
      <Stack>
        <Loader />
      </Stack>
    );
  }
  return (
    <Stack>
      <div>
        <Title order={3}>{t("facecluster")}</Title>
        <Text c="dimmed">{t("faceclusterexplanation")}</Text>
      </div>
      <Text>{t("nofaces")}</Text>
    </Stack>
  );
}

export default FaceClusterGraph;
