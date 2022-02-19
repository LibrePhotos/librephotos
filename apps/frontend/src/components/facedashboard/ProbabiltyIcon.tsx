import React from "react";
import { Popup, Icon } from "semantic-ui-react";
import { SortableItem } from "../settings/SortableItem";
import { useTranslation } from "react-i18next";

type Props = {
  probability: number;
};

export const ProbabilityIcon = (props: Props) => {
  const calculateProbabiltyColor = (labelProbability: number) => {
    return labelProbability > 0.9
      ? "green"
      : labelProbability > 0.8
      ? "yellow"
      : labelProbability > 0.7
      ? "orange"
      : "red";
  };
  const labelProbabilityColor = calculateProbabiltyColor(props.probability);

  return (
    <div style={{ right: 6, bottom: 6, position: "absolute" }}>
      <Popup
        trigger={
          <Icon
            circular
            style={{ backgroundColor: "white" }}
            color={labelProbabilityColor}
            name="circle"
          />
        }
        on="focus"
        flowing
        inverted
        hideOnScroll
        position="bottom center"
        content={
          //To-Do: Translate this
          `Confidence: ${(props.probability * 100).toFixed(1)}%`
        }
      />
    </div>
  );
};
