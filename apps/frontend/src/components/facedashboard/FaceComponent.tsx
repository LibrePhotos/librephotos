import { ActionIcon, Avatar, Box, Indicator } from "@mantine/core";
import { IconPhoto as Photo } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import _ from "lodash";
import React, { useState } from "react";
import { serverAddress } from "../../api_client/apiClient";
import classes from "./FaceComponent.module.css";
import { FaceTooltip } from "./FaceTooltip";
import { FaceCell } from "./hooks/useVirtualizedGrid";

type Props = Readonly<{
  cell: FaceCell;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  handleClick: (e: any, cell: any) => void;
  handleShowClick: (e: any, cell: any) => void;
}>;

export const calculateProbabiltyColor = (labelProbability: number) => {
  if (labelProbability > 0.9) return "green";
  if (labelProbability > 0.8) return "yellow";
  if (labelProbability > 0.7) return "orange";
  return "red";
};

const routeApi = getRouteApi("/_protected/faces");

function getFaceImageUrl(cell: FaceCell): string {
  // cell.image is string e.g. http://backeng/path/to/file.jpg
  const fileName = _.reverse(cell.image.split("/"))[0];
  return `${serverAddress}/media/faces/${fileName}`;
}

export function FaceComponent({
  cell,
  isScrollingFast,
  selectMode,
  entrySquareSize,
  isSelected,
  handleClick,
  handleShowClick,
}: Props) {
  const [tooltipOpened, setTooltipOpened] = useState(false);
  const entrySize = entrySquareSize - (selectMode ? 30 : 10);
  const labelProbabilityColor = calculateProbabiltyColor(cell.person_label_probability);
  const { tab: activeTab } = routeApi.useSearch();

  if (isScrollingFast) {
    return <Avatar radius="md" src="/thumbnail_placeholder.png" size={entrySize} />;
  }

  return (
    <Box className={classes.box} data-selected={isSelected} w="100%" h="100%" align="center">
      <Box>
        <FaceTooltip
          tooltipOpened={tooltipOpened}
          probability={cell.person_label_probability}
          timestamp={cell.timestamp}
        >
          <Indicator
            offset={10}
            withBorder
            color={labelProbabilityColor}
            onMouseEnter={() => setTooltipOpened(true)}
            onMouseLeave={() => setTooltipOpened(false)}
            disabled={activeTab === "labeled"}
            size={15}
          >
            <Avatar
              radius="md"
              onClick={(e: any) => {
                handleClick(e, cell);
              }}
              src={getFaceImageUrl(cell)}
              size={entrySize}
            />
          </Indicator>
        </FaceTooltip>
        <ActionIcon
          className={classes.action}
          variant="filled"
          color="gray"
          onClick={(e: any) => handleShowClick(e, cell)}
        >
          <Photo />
        </ActionIcon>
      </Box>
    </Box>
  );
}
