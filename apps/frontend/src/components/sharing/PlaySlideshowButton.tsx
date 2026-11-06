import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";

type Props = Readonly<{ onPlay: () => void }>;

/**
 * A public album's Play slideshow (#1457), so a visitor with the plain album link can start what
 * the slideshow link starts. Labelled on wider screens, an icon on a phone where the label would
 * push the album title off.
 */
export function PlaySlideshowButton({ onPlay }: Props) {
  const { t } = useTranslation();
  const label = t("publicalbum.playSlideshow");
  return (
    <>
      <Button
        visibleFrom="sm"
        variant="light"
        h={TOOLBAR_CONTROL_HEIGHT}
        leftSection={<IconPlayerPlay size={ICON_SIZE.toolbar} />}
        onClick={onPlay}
      >
        {label}
      </Button>
      <Tooltip label={label} hiddenFrom="sm">
        <ActionIcon hiddenFrom="sm" variant="light" size={TOOLBAR_ACTION_SIZE} aria-label={label} onClick={onPlay}>
          <IconPlayerPlay size={ICON_SIZE.toolbar} />
        </ActionIcon>
      </Tooltip>
    </>
  );
}
