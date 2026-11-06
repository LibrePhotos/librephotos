import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { HeaderActionsMenu } from "./HeaderActionsMenu";
import { MediaTypeSelector } from "./MediaTypeSelector";
import { PhotoListDisplayOptions } from "./PhotoListDisplayOptions";
import { SelectModeButton } from "./SelectModeButton";
import type { usePhotoListPreferences } from "./usePhotoListPreferences";
import { ViewOptionsContext } from "./viewOptionsContext";

type Props = Readonly<{
  /** The page's own controls (PhotoListView's `headerActions`): a Filter, after the media type. */
  headerActions?: React.ReactNode;
  /** The page's ⋯ (PhotoListView's `headerMenu`, a HeaderActionsMenu), always last. */
  headerMenu?: React.ReactNode;
  /**
   * The list's own controls can show: the photos are loaded and the view is not read-only
   * (`isPublic`). headerActions show either way.
   */
  listControls: boolean;
  hasPhotos: boolean;
  /** The page filters by media type (PhotoListView's `mediaType` is set). */
  mediaFilter: boolean;
  /** A user album with a public link: a button opens its sharing dialog. */
  publicLink: boolean;
  onOpenSharing: () => void;
  preferences: ReturnType<typeof usePhotoListPreferences>;
  /** On a list of days: they follow the user's photo order, or always read oldest first (events). */
  photoOrder?: "setting" | "events";
  /** The Select button (#2240), on a list whose photos can be selected. */
  selectMode?: React.ComponentProps<typeof SelectModeButton>;
}>;

function DisplayOptions({ preferences, photoOrder }: Readonly<Pick<Props, "preferences" | "photoOrder">>) {
  return (
    <PhotoListDisplayOptions
      localImageScale={preferences.localImageScale}
      localTextAlignment={preferences.localTextAlignment}
      localHeaderSize={preferences.localHeaderSize}
      localScrubberStyle={preferences.localScrubberStyle}
      onThumbnailSizeChange={preferences.handleThumbnailSizeChange}
      onTextAlignmentChange={preferences.handleTextAlignmentChange}
      onHeaderSizeChange={preferences.handleHeaderSizeChange}
      onScrubberStyleChange={preferences.handleScrubberStyleChange}
      photoOrder={
        photoOrder && {
          order: preferences.photoOrder,
          onChange: preferences.handlePhotoOrderChange,
          eventOrder: photoOrder === "events",
        }
      }
    />
  );
}

/**
 * The right-hand side of a photo list's header, in the order every page header keeps: the
 * media-type dropdown, the page's Filter, a public album's link, Select, then the ⋯ holding the
 * page's actions and "View options…" (the display options, so there is no second "adjust" icon
 * beside a Filter).
 *
 * headerActions stay mounted while the view reloads: changing the timeline filter refetches, and
 * an open filter popover must not close under the pointer. The other controls wait for the
 * photos, and are not offered on a read-only view, where headerActions are all there is (leaving
 * an album shared with you).
 */
export function PhotoListToolbar({
  headerActions,
  headerMenu,
  listControls,
  hasPhotos,
  mediaFilter,
  publicLink,
  onOpenSharing,
  preferences,
  photoOrder,
  selectMode,
}: Props) {
  const { t } = useTranslation();
  const withPhotos = listControls && hasPhotos;

  if (!headerActions && !headerMenu && !withPhotos && !(listControls && mediaFilter)) return null;

  return (
    <Group gap={4} wrap="nowrap">
      {/* The media-type filter stays visible even when the current
          filter yields no photos, so the user is never trapped. */}
      {listControls && mediaFilter && <MediaTypeSelector />}
      {headerActions}
      {withPhotos && publicLink && (
        // A phone keeps two icons beside the ⋯: the album's ⋯ shares it there
        <Tooltip label={t("sidemenu.sharing")} position="bottom">
          <ActionIcon
            {...toolbarLook()}
            visibleFrom="sm"
            size={TOOLBAR_ACTION_SIZE}
            aria-label={t("sidemenu.sharing")}
            onClick={onOpenSharing}
          >
            <IconLink size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Tooltip>
      )}
      {withPhotos && selectMode && <SelectModeButton {...selectMode} />}
      <ViewOptionsContext
        value={withPhotos ? <DisplayOptions preferences={preferences} photoOrder={photoOrder} /> : null}
      >
        {headerMenu ?? <HeaderActionsMenu label={t("photodisplay.more")} />}
      </ViewOptionsContext>
    </Group>
  );
}
