import { Image } from "@mantine/core";
import React, { useEffect, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Header, Label, Loader } from "semantic-ui-react";

import { clusterFaces } from "../../actions/facesActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { XYPlot, HorizontalGridLines, Hint, MarkSeries, VerticalGridLines } = require("react-vis");

type Props = {
  height: number;
};

export function FaceClusterGraph(props: Props) {
  const [hintValue, setHintValue] = useState<any>({} as any);
  const { t } = useTranslation();
  const { observe, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
      observe();
    },
  });
  const dispatch = useAppDispatch();
  const { facesVis, clustered, clustering } = useAppSelector(state => state.faces);

  useEffect(() => {
    clusterFaces(dispatch);
  }, [dispatch]); // Only run on first render

  const person_names = [...new Set(facesVis.map((el: any) => el.person_name))];

  const mappedScatter = person_names.map((person_name, idx) => {
    const thisPersonVis = facesVis.filter((el: any) => person_name === el.person_name);
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
        key={`cluster-marker-${idx}`}
        animation
        onValueClick={(d: any, info: any) => {
          setHintValue(d);
        }}
        data={thisPersonData}
      />
    );
    // @ts-ignore
  }, this);
  if (clustered) {
    return (
      <div style={{ padding: 10 }} ref={observe}>
        <Header>
          <Header.Content>
            {t("facecluster")} <Header.Subheader>{t("faceclusterexplanation")}</Header.Subheader>
          </Header.Content>
        </Header>
        <XYPlot width={width - 30} height={props.height}>
          <HorizontalGridLines />
          <VerticalGridLines />
          {mappedScatter}
          {hintValue.name && (
            <Hint value={hintValue}>
              <Label color="black">
                {hintValue.name}
                <Image radius="xl" height={70} width={70} src={serverAddress + hintValue.face_url} />
              </Label>
            </Hint>
          )}
        </XYPlot>
      </div>
    );
  }
  if (clustering) {
    return (
      <div style={{ padding: 10 }}>
        <Loader active />
      </div>
    );
  }
  return (
    <div style={{ padding: 10 }}>
      <Header>
        <Header.Content>
          {t("facecluster")} <Header.Subheader>{t("faceclusterexplanation")}</Header.Subheader>
        </Header.Content>
      </Header>
      <div>{t("nofaces")}</div>
    </div>
  );
}

export default FaceClusterGraph;
