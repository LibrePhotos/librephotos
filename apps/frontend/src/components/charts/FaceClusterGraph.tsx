import React, { useEffect, useState } from "react";
import { Header, Label, Loader } from "semantic-ui-react";
import useDimensions from "react-cool-dimensions";
import { serverAddress } from "../../api_client/apiClient";
import { clusterFaces } from "../../actions/facesActions";
import { SecuredImageJWT } from "../SecuredImage";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { XYPlot, HorizontalGridLines, Hint, MarkSeries, VerticalGridLines } = require("react-vis");

type Props = {
  height: number;
};

export const FaceClusterGraph = (props: Props) => {
  const [hintValue, setHintValue] = useState<any>({} as any);
  const { t } = useTranslation();
  const { observe, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
      observe();
    },
  });
  const dispatch = useAppDispatch();
  const { facesVis, clustered, clustering } = useAppSelector((state) => state.faces);

  useEffect(() => {
    clusterFaces(dispatch);
  }, [dispatch]); // Only run on first render

  var person_names = [
    ...new Set(
      facesVis.map(function (el: any) {
        return el.person_name;
      })
    ),
  ];

  var mappedScatter = person_names.map(function (person_name, idx) {
    var thisPersonVis = facesVis.filter(function (el: any) {
      return person_name === el.person_name;
    });
    var thisPersonData = thisPersonVis.map(function (el: any) {
      return {
        x: el.value.x,
        y: el.value.y,
        size: el.value.size,
        name: el.person_name,
        color: el.color,
        face_url: el.face_url,
        photo: el.photo,
      };
    });
    return (
      <MarkSeries
        colorType="literal"
        key={"cluster-marker-" + idx}
        animation
        onValueClick={(d: any, info: any) => {
          setHintValue(d);
        }}
        data={thisPersonData}
      />
    );
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
                <SecuredImageJWT
                  style={{ borderRadius: "1em" }}
                  floated="right"
                  height={70}
                  width={70}
                  shape="rounded"
                  src={serverAddress + hintValue.face_url}
                ></SecuredImageJWT>
              </Label>
            </Hint>
          )}
        </XYPlot>
      </div>
    );
  } else {
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
};

export default FaceClusterGraph;
