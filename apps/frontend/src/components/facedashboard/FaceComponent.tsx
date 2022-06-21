import { Avatar, Box, Center, Indicator, Tooltip } from "@mantine/core";
import { t } from "i18next";
import _ from "lodash";
import React, { useState } from "react";

import { serverAddress } from "../../api_client/apiClient";
import { PhotoIcon } from "./PhotoIcon";

type Props = {
  cell: any;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  activeItem: number;
  handleClick: (e: any, cell: any) => void;
};

export function FaceComponent(props: Props) {
  const calculateProbabiltyColor = (labelProbability: number) =>
    labelProbability > 0.9 ? "green" : labelProbability > 0.8 ? "yellow" : labelProbability > 0.7 ? "orange" : "red";

  const labelProbabilityColor = calculateProbabiltyColor(props.cell.person_label_probability);
  const showPhotoIcon = <PhotoIcon photo={props.cell.photo} />;
  const [tooltipOpened, setTooltipOpened] = useState(false);
  // TODO: janky shit going on in the next line!
  const faceImageSrc = `${serverAddress}/media/faces/${_.reverse(props.cell.image.split("/"))[0]}`;
  if (props.isScrollingFast) {
    return <Avatar radius="xl" src="/thumbnail_placeholder.png" size={props.entrySquareSize - 10} />;
  }
  if (props.selectMode) {
    const { isSelected } = props;
    return (
      <Box
        sx={theme => ({
          display: "block",
          backgroundColor: isSelected ? "rgba(174, 214, 241, 0.7)" : "transparent",
          alignContent: "center",
          borderRadius: theme.radius.md,
          padding: 10,
          marginRight: 10,
          cursor: "pointer",
          "&:hover": {
            backgroundColor: isSelected ? "rgba(174, 214, 241, 0.95)" : "rgba(174, 214, 241, 0.7)",
          },
        })}
      >
        <Center>
          <Tooltip
            opened={tooltipOpened && props.activeItem === 1}
            label={`Confidence: ${(props.cell.person_label_probability * 100).toFixed(1)}%`}
            position="bottom"
            withArrow
          >
            <Indicator
              color={labelProbabilityColor}
              onMouseEnter={() => setTooltipOpened(true)}
              onMouseLeave={() => setTooltipOpened(false)}
              disabled={props.activeItem === 0}
              size={15}
            >
              <Avatar
                radius="xl"
                onClick={(e: any) => {
                  props.handleClick(e, props.cell);
                }}
                src={faceImageSrc}
                size={props.entrySquareSize - 30}
              />
            </Indicator>
          </Tooltip>
          {showPhotoIcon}
        </Center>
      </Box>
    );
  }
  return (
    <Box
      sx={theme => ({
        display: "block",
        backgroundColor: "transparent",
        alignContent: "center",
        borderRadius: theme.radius.md,
        padding: 0,
        marginRight: 10,
        cursor: "pointer",
        "&:hover": {
          backgroundColor: "rgba(174, 214, 241, 0.7)",
        },
      })}
    >
      <Center>
        <Tooltip
          opened={tooltipOpened && props.activeItem === 1}
          label={t("confidencepercentage", {
            percentage: (props.cell.person_label_probability * 100).toFixed(1),
          })}
          position="bottom"
        >
          <Indicator
            offset={10}
            color={labelProbabilityColor}
            onMouseEnter={() => setTooltipOpened(true)}
            onMouseLeave={() => setTooltipOpened(false)}
            disabled={props.activeItem === 0}
            size={15}
          >
            <Avatar
              onClick={(e: any) => {
                props.handleClick(e, props.cell);
              }}
              radius="xl"
              src={faceImageSrc}
              size={props.entrySquareSize - 10}
            />
          </Indicator>
        </Tooltip>
        {showPhotoIcon}
      </Center>
    </Box>
  );
}
