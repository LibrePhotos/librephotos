import { ActionIcon, Avatar, Box, Indicator } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPhoto as Photo } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import classes from "./FaceComponent.module.css";
import { FaceTooltip } from "./FaceTooltip";
import type { FaceCell } from "./hooks/useVirtualizedGrid";

type Props = Readonly<{
  cell: FaceCell;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  handleClick: (e: React.MouseEvent, cell: FaceCell) => void;
  handleShowClick: (e: React.MouseEvent, cell: FaceCell) => void;
}>;

export const calculateProbabiltyColor = (labelProbability: number) => {
  if (labelProbability > 0.9) return "green";
  if (labelProbability > 0.8) return "yellow";
  if (labelProbability > 0.7) return "orange";
  return "red";
};

const routeApi = getRouteApi("/_protected/faces");

function getFaceImageUrl(image: string): string {
  // image is a URL, e.g. http://backend/path/to/file.jpg
  const fileName = image.split("/").at(-1) ?? "";
  return mediaUrl.face(fileName);
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
  const { t } = useTranslation();
  const [tooltipOpened, { open: openTooltip, close: closeTooltip }] = useDisclosure(false);
  const entrySize = entrySquareSize - (selectMode ? 30 : 10);
  // The face list always sends it; only a placeholder could lack it.
  const probability = cell.person_label_probability ?? 0;
  const labelProbabilityColor = calculateProbabiltyColor(probability);
  const { tab: activeTab } = routeApi.useSearch();

  if (isScrollingFast) {
    return <Avatar radius="md" src="/thumbnail_placeholder.png" size={entrySize} />;
  }

  return (
    <Box className={classes.box} data-selected={isSelected} w="100%" h="100%">
      <Box>
        <FaceTooltip tooltipOpened={tooltipOpened} probability={probability} timestamp={cell.timestamp}>
          <Indicator
            offset={10}
            withBorder
            color={labelProbabilityColor}
            onMouseEnter={() => openTooltip()}
            onMouseLeave={() => closeTooltip()}
            disabled={activeTab === "labeled"}
            size={15}
          >
            <Avatar
              radius="md"
              onClick={e => {
                handleClick(e, cell);
              }}
              // A paged-in face always has its image; null would only be a placeholder's
              src={cell.image ? getFaceImageUrl(cell.image) : undefined}
              size={entrySize}
            />
          </Indicator>
        </FaceTooltip>
        <ActionIcon
          className={classes.action}
          variant="filled"
          color="gray"
          aria-label={t("facesdashboard.showphoto")}
          onClick={e => handleShowClick(e, cell)}
        >
          <Photo />
        </ActionIcon>
      </Box>
    </Box>
  );
}
