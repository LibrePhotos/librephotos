import { Avatar, Box, Flex, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlayerPlayFilled, IconUser as User } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { formatVideoTime } from "../../util/dateUtils";
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
  /** The face's square cell (faceGridRows.ts); a selected face draws in inside it. */
  faceSize: number;
  isSelected: boolean;
  handleClick: (e: React.MouseEvent, cell: FaceCell) => void;
  handleShowClick: (e: React.MouseEvent, cell: FaceCell) => void;
}>;

/** The corner radius of a face, as of the photo tiles' rounded cards. */
const FACE_RADIUS = 12;
/** How far a selected face draws in from its tinted cell, on each side. */
const SELECTED_INSET = 6;
/** A suggestion at most this sure is drawn faded (the toolbar's ⋯ menu explains it). */
export const UNSURE_PROBABILITY = 0.8;

export const calculateProbabiltyColor = (labelProbability: number) => {
  if (labelProbability > 0.9) return "green";
  if (labelProbability > 0.8) return "yellow";
  if (labelProbability > 0.7) return "orange";
  return "red";
};

/** The face button's name; a face from a later video frame says where in the video it is (#2762). */
function faceLabel(t: TFunction, cell: FaceCell, name: string): string {
  if (typeof cell.video_time === "number") {
    return t("facesdashboard.faceinvideo", { name, time: formatVideoTime(cell.video_time) });
  }
  return t(cell.image ? "facesdashboard.facein" : "facesdashboard.faceinnothumbnail", { name });
}

/** A face's group as the face shows it: its name, and its kind for the actions (faceActionRules). */
const sameGroup = (a: CompletePersonFace | undefined, b: CompletePersonFace | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.id === b.id && a.name === b.name && a.kind === b.kind);

/**
 * Whether a face can skip drawing again. Its group is a new object whenever one of the group's
 * faces changes (an edit, a page landing), which would draw every face on screen again; the face
 * only shows the group's name and kind. Every other prop is compared as React.memo would.
 */
function sameFaceProps(prev: Props, next: Props): boolean {
  return (
    prev.cell === next.cell &&
    sameGroup(prev.group, next.group) &&
    prev.tab === next.tab &&
    prev.actions === next.actions &&
    prev.pending === next.pending &&
    prev.isScrollingFast === next.isScrollingFast &&
    prev.selectMode === next.selectMode &&
    prev.faceSize === next.faceSize &&
    prev.isSelected === next.isSelected &&
    prev.handleClick === next.handleClick &&
    prev.handleShowClick === next.handleShowClick
  );
}

export const FaceComponent = memo(FaceComponentView, sameFaceProps);

function FaceComponentView({
  cell,
  group,
  tab,
  actions,
  pending,
  isScrollingFast,
  selectMode,
  faceSize,
  isSelected,
  handleClick,
  handleShowClick,
}: Props) {
  const { t } = useTranslation();
  const [tooltipOpened, { open: openTooltip, close: closeTooltip }] = useDisclosure(false);
  const [menuOpened, { set: setMenuOpened, open: openMenu }] = useDisclosure(false);
  // The face fills its cell; a selected one draws in a little, inside its tinted cell
  const entrySize = faceSize - (isSelected ? 2 * SELECTED_INSET : 0);
  // The face list always sends it; only a placeholder could lack it.
  const probability = cell.person_label_probability ?? 0;
  // A confidence only means something for a suggestion: an unsure one is faded, not dotted
  // (the Inferred tab's, as its tooltip's score; "Unknown - Other" suggests no one)
  const unsure = tab === "inferred" && probability <= UNSURE_PROBABILITY;

  if (isScrollingFast) {
    return <Avatar radius={FACE_RADIUS} src="/thumbnail_placeholder.png" size={entrySize} />;
  }

  return (
    <Box
      className={classes.box}
      data-selected={isSelected}
      data-pending={pending || undefined}
      data-unsure={unsure || undefined}
      w="100%"
      h="100%"
    >
      <div className={classes.face}>
        <FaceTooltip tooltipOpened={tooltipOpened} probability={probability} timestamp={cell.timestamp}>
          {/* A button, so a keyboard reaches and selects every face, not only its photo (#2228) */}
          <UnstyledButton
            className={classes.faceButton}
            data-focus-key="face"
            aria-label={faceLabel(t, cell, group?.name ?? cell.person_name ?? "")}
            aria-pressed={isSelected}
            onClick={e => handleClick(e, cell)}
            onFocus={openTooltip}
            onBlur={closeTooltip}
            onMouseEnter={openTooltip}
            onMouseLeave={closeTooltip}
            // Right click, and a long press on Android, open the face's menu
            onContextMenu={e => {
              e.preventDefault();
              openMenu();
            }}
          >
            {cell.image ? (
              <Avatar radius={FACE_RADIUS} src={faceImageUrl(cell.image)} size={entrySize} />
            ) : (
              // A face whose crop is missing still gets a tile, so it can be relabelled or deleted
              // (#2636). The placeholder is the one of a thing album without a cover (#2234).
              <Flex className={classes.noThumbnail} align="center" justify="center" w={entrySize} h={entrySize}>
                <User size={40} stroke={1.5} />
              </Flex>
            )}
            {typeof cell.video_time === "number" && (
              <span className={classes.videoTime} aria-hidden="true">
                <IconPlayerPlayFilled size={10} />
                {formatVideoTime(cell.video_time)}
              </span>
            )}
          </UnstyledButton>
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
