import { Avatar, Box, Center, Indicator } from "@mantine/core";
import _ from "lodash";
import React, { useState } from "react";
import { serverAddress } from "../../api_client/apiClient";
import { PhotoIcon } from "./PhotoIcon";
import { FaceTooltip } from "./FaceTooltip";


type Props = {
  cell: any;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  activeItem: number;
  handleClick: (e: any, cell: any) => void;
};

export function FaceComponent({ cell, isScrollingFast, selectMode, entrySquareSize, isSelected, activeItem, handleClick }: Props) {
  const calculateProbabiltyColor = (labelProbability: number) => {
    if (labelProbability > 0.9) return "green";
    if (labelProbability > 0.8) return "yellow";
    if (labelProbability > 0.7) return "orange";
    return "red";
  };

  const labelProbabilityColor = calculateProbabiltyColor(cell.person_label_probability);
  const showPhotoIcon = <PhotoIcon photo={cell.photo} />;
  const [tooltipOpened, setTooltipOpened] = useState(false);
  // TODO: janky shit going on in the next line!
  const faceImageSrc = `${serverAddress}/media/faces/${_.reverse(cell.image.split("/"))[0]}`;

  let offset: number = 0;
  let size: number = entrySquareSize - 10;
  let padding: number = 0;
  if (selectMode) {
    // display smaller faces to distinguish between normal and select mode
    offset = 10;
    size = entrySquareSize - 30;
    padding = 10;
  }

  if (isScrollingFast) {
    return <Avatar radius="xl" src="/thumbnail_placeholder.png" size={entrySquareSize - 10} />;
  }
  return (
    <Box
      sx={theme => ({
        display: "block",
        backgroundColor: isSelected ? "rgba(174, 214, 241, 0.7)" : "transparent",
        alignContent: "center",
        borderRadius: theme.radius.md,
        padding: padding,
        marginRight: 10,
        cursor: "pointer",
        "&:hover": {
          backgroundColor: isSelected ? "rgba(174, 214, 241, 0.95)" : "rgba(174, 214, 241, 0.7)",
        },
      })}
    >
      <Center>
        <FaceTooltip
            tooltipOpened={tooltipOpened}
            activeItem={activeItem}
            cell={cell}
        >
          <Indicator
            offset={offset}
            color={labelProbabilityColor}
            onMouseEnter={() => setTooltipOpened(true)}
            onMouseLeave={() => setTooltipOpened(false)}
            disabled={activeItem === 0}
            size={15}
          >
            <Avatar
              radius="xl"
              onClick={(e: any) => {
                handleClick(e, cell);
              }}
              src={faceImageSrc}
              size={size}
            />
          </Indicator>
        </FaceTooltip>
        {showPhotoIcon}
      </Center>
    </Box>
  );
}
