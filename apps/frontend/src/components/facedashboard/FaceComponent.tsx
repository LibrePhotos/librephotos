import { Avatar, Box, Flex, Indicator, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconUser as User } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { CompletePersonFace } from "../../api_client/faces/types";
import type { FaceActionHandlers } from "./faceActionRules";
import { FaceActions } from "./FaceActions";
import classes from "./FaceComponent.module.css";
import type { FacesTab } from "./facesTab";
import { FaceTooltip } from "./FaceTooltip";
import type { FaceCell } from "./hooks/useVirtualizedGrid";
import { faceImageUrl } from "./personCover";

type Props = Readonly<{
  cell: FaceCell;
  /** The person or cluster whose group the face is shown in. */
  group: CompletePersonFace | undefined;
  tab: FacesTab;
  actions: FaceActionHandlers;
  /** An action on this face was sent: it is dimmed until the refreshed list drops it. */
  pending: boolean;
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

export function FaceComponent({
  cell,
  group,
  tab,
  actions,
  pending,
  isScrollingFast,
  selectMode,
  entrySquareSize,
  isSelected,
  handleClick,
  handleShowClick,
}: Props) {
  const { t } = useTranslation();
  const [tooltipOpened, { open: openTooltip, close: closeTooltip }] = useDisclosure(false);
  const [menuOpened, { set: setMenuOpened, open: openMenu }] = useDisclosure(false);
  const entrySize = entrySquareSize - (selectMode ? 30 : 10);
  // The face list always sends it; only a placeholder could lack it.
  const probability = cell.person_label_probability ?? 0;
  const labelProbabilityColor = calculateProbabiltyColor(probability);

  if (isScrollingFast) {
    return <Avatar radius="md" src="/thumbnail_placeholder.png" size={entrySize} />;
  }

  return (
    <Box className={classes.box} data-selected={isSelected} data-pending={pending || undefined} w="100%" h="100%">
      <div className={classes.face}>
        <FaceTooltip tooltipOpened={tooltipOpened} probability={probability} timestamp={cell.timestamp}>
          <Indicator
            offset={10}
            withBorder
            color={labelProbabilityColor}
            onMouseEnter={() => openTooltip()}
            onMouseLeave={() => closeTooltip()}
            disabled={tab === "labeled"}
            size={15}
          >
            {/* A button, so a keyboard reaches and selects every face, not only its photo (#2228) */}
            <UnstyledButton
              className={classes.faceButton}
              data-focus-key="face"
              aria-label={t(cell.image ? "facesdashboard.facein" : "facesdashboard.faceinnothumbnail", {
                name: group?.name ?? cell.person_name ?? "",
              })}
              aria-pressed={isSelected}
              onClick={e => handleClick(e, cell)}
              onFocus={openTooltip}
              onBlur={closeTooltip}
              // Right click, and a long press on Android, open the face's menu
              onContextMenu={e => {
                e.preventDefault();
                openMenu();
              }}
            >
              {cell.image ? (
                <Avatar radius="md" src={faceImageUrl(cell.image)} size={entrySize} />
              ) : (
                // A face whose crop is missing still gets a tile, so it can be relabelled or deleted
                // (#2636). The placeholder is the one of a thing album without a cover (#2234).
                <Flex className={classes.noThumbnail} align="center" justify="center" w={entrySize} h={entrySize}>
                  <User size={40} stroke={1.5} />
                </Flex>
              )}
            </UnstyledButton>
          </Indicator>
        </FaceTooltip>
        {group && (
          <FaceActions
            face={cell}
            group={group}
            tab={tab}
            actions={actions}
            onShowPhoto={handleShowClick}
            selectMode={selectMode}
            pending={pending}
            menuOpened={menuOpened}
            onMenuChange={setMenuOpened}
          />
        )}
      </div>
    </Box>
  );
}
