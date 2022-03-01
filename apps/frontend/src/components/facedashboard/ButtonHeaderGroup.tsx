import React from "react";
import { Checkbox, Popup, Button } from "semantic-ui-react";
import { useTranslation } from "react-i18next";
import { trainFaces } from "../../actions/facesActions";

type Props = {
  selectMode: boolean;
  selectedFaces: any;
  workerAvailability: any;
  workerRunningJob: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: (faces: any) => void;
  trainFaces: () => void;
};

export const ButtonHeaderGroup = (props: Props) => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        marginLeft: -5,
        paddingLeft: 5,
        paddingRight: 5,
        height: 40,
        paddingTop: 4,
        backgroundColor: props.selectMode ? "#AED6F1" : "#eeeeee",
      }}
    >
      <Checkbox
        label={t("facesdashboard.selectedfaces", {
          number: props.selectedFaces.length,
        })}
        style={{ padding: 5 }}
        toggle
        checked={props.selectMode}
        onClick={props.changeSelectMode}
      />

      <Button.Group compact floated="right">
        <Popup
          inverted
          trigger={
            <Button
              color="green"
              disabled={props.selectedFaces.length === 0}
              onClick={props.addFaces}
              icon="plus"
            />
          }
          content={t("facesdashboard.explanationadding")}
        />
        <Popup
          inverted
          trigger={
            //To-Do: Confirmation of delete faces
            <Button
              color="red"
              disabled={props.selectedFaces.length === 0}
              onClick={props.deleteFaces}
              icon="trash"
            />
          }
          content={t("facesdashboard.explanationdeleting")}
        />

        <Popup
          inverted
          trigger={
            <Button
              disabled={!props.workerAvailability}
              loading={
                props.workerRunningJob &&
                props.workerRunningJob.job_type_str === "Train Faces"
              }
              color="blue"
              onClick={props.trainFaces}
              icon="lightning"
            />
          }
          content={t("facesdashboard.explanationtraining")}
        />
      </Button.Group>
    </div>
  );
};
