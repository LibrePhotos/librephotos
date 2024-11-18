import { ActionIcon, Avatar, Box, Center, Indicator, useMantineTheme } from "@mantine/core";
import { IconPhoto as Photo } from "@tabler/icons-react";
import _ from "lodash";
import React, { useState } from "react";

import { serverAddress } from "../../api_client/apiClient";
import { useAppSelector } from "../../store/store";
import "./FaceComponent.css";
import { FaceTooltip } from "./FaceTooltip";

type Props = Readonly<{
  cell: any;
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

export function FaceComponent({
  cell,
  isScrollingFast,
  selectMode,
  entrySquareSize,
  isSelected,
  handleClick,
  handleShowClick,
}: Props) {
  const theme = useMantineTheme();

  const labelProbabilityColor = calculateProbabiltyColor(cell.person_label_probability);
  const [tooltipOpened, setTooltipOpened] = useState(false);
  const { activeTab } = useAppSelector(store => store.face);
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
      className={`box ${isSelected ? "selected" : ""}`}
      style={{
        alignContent: "center",
        padding,
        marginRight: 10,
        cursor: "pointer",
        borderRadius: theme.radius.md,
      }}
    >
      <Center>
        <FaceTooltip
          tooltipOpened={tooltipOpened}
          probability={cell.person_label_probability}
          timestamp={cell.timestamp}
        >
          <Indicator
            offset={offset}
            color={labelProbabilityColor}
            onMouseEnter={() => setTooltipOpened(true)}
            onMouseLeave={() => setTooltipOpened(false)}
            disabled={activeTab === "labeled"}
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
        <div style={{ left: 0, bottom: 0, position: "absolute" }}>
          <ActionIcon variant="filled" color="gray" onClick={(e: any) => handleShowClick(e, cell)}>
            <Photo />
          </ActionIcon>
        </div>
      </Center>
    </Box>
  );
}
