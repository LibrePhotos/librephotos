import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { MediaTypeSelector } from "./MediaTypeSelector";
import { PhotoListDisplayMenu } from "./PhotoListDisplayMenu";
import type { usePhotoListPreferences } from "./usePhotoListPreferences";

type Props = Readonly<{
  /** The page's own controls (PhotoListView's `headerActions`). */
  headerActions?: React.ReactNode;
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
}>;

/**
 * The right-hand toolbar of a photo list's header: the media-type filter, the page's actions, a
 * public album's link button and the display settings.
 *
 * headerActions stay mounted while the view reloads: changing the timeline filter refetches, and
 * an open filter popover must not close under the pointer. The other controls wait for the
 * photos, and are not offered on a read-only view, where headerActions are all there is (leaving
 * an album shared with you).
 */
export function PhotoListToolbar({
  headerActions,
  listControls,
  hasPhotos,
  mediaFilter,
  publicLink,
  onOpenSharing,
  preferences,
}: Props) {
  const { t } = useTranslation();
  const [displayMenuOpened, { open: openDisplayMenu, close: closeDisplayMenu }] = useDisclosure(false);
  const withPhotos = listControls && hasPhotos;

  if (!headerActions && !withPhotos && !(listControls && mediaFilter)) return null;

  return (
    <Box ml="auto">
      <Group gap="xs" wrap="nowrap">
        {/* The media-type filter stays visible even when the current
          filter yields no photos, so the user is never trapped. */}
        {listControls && mediaFilter && <MediaTypeSelector />}
        {headerActions}
        {withPhotos && publicLink && (
          <Tooltip label={t("sidemenu.sharing")} position="bottom">
            <ActionIcon
              variant="default"
              size={TOOLBAR_ACTION_SIZE}
              aria-label={t("sidemenu.sharing")}
              onClick={onOpenSharing}
            >
              <IconLink size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Tooltip>
        )}
        {withPhotos && (
          <PhotoListDisplayMenu
            displayMenuOpened={displayMenuOpened}
            openDisplayMenu={openDisplayMenu}
            closeDisplayMenu={closeDisplayMenu}
            localImageScale={preferences.localImageScale}
            localTextAlignment={preferences.localTextAlignment}
            localHeaderSize={preferences.localHeaderSize}
            onThumbnailSizeChange={preferences.handleThumbnailSizeChange}
            onTextAlignmentChange={preferences.handleTextAlignmentChange}
            onHeaderSizeChange={preferences.handleHeaderSizeChange}
          />
        )}
      </Group>
    </Box>
  );
}
