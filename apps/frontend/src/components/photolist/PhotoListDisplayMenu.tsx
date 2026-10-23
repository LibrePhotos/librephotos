import { ActionIcon, Box, Menu, SegmentedControl, Slider, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import type { ScrubberStyle } from "../scrollscrubber/scrollScrubberTypes";
import { PhotoOrderSection } from "./PhotoOrderSection";
import { isHeaderSize, isScrubberStyle, type HeaderSize } from "./usePhotoListPreferences";

type Props = Readonly<{
  displayMenuOpened: boolean;
  openDisplayMenu: () => void;
  closeDisplayMenu: () => void;
  localImageScale: number;
  localTextAlignment: "left" | "right";
  localHeaderSize: HeaderSize;
  localScrubberStyle: ScrubberStyle;
  onThumbnailSizeChange: (value: number) => void;
  onTextAlignmentChange: (alignment: "left" | "right") => void;
  onHeaderSizeChange: (size: HeaderSize) => void;
  onScrubberStyleChange: (style: ScrubberStyle) => void;
  /** The Order section, on a list whose days it orders (#2712); left out on the others. */
  photoOrder?: React.ComponentProps<typeof PhotoOrderSection>;
}>;

// The order, photo size, text alignment, header size and scroll bar menu in a photo list's toolbar.
export function PhotoListDisplayMenu({
  displayMenuOpened,
  openDisplayMenu,
  closeDisplayMenu,
  localImageScale,
  localTextAlignment,
  localHeaderSize,
  localScrubberStyle,
  onThumbnailSizeChange,
  onTextAlignmentChange,
  onHeaderSizeChange,
  onScrubberStyleChange,
  photoOrder,
}: Props) {
  const { t } = useTranslation();
  return (
    <Menu
      shadow="md"
      width={240}
      position="bottom-end"
      opened={displayMenuOpened}
      onChange={isOpen => (isOpen ? openDisplayMenu() : closeDisplayMenu())}
    >
      <Menu.Target>
        {/* Hidden while the menu is open: it would sit over the menu's first label. */}
        <Tooltip label={t("photodisplay.settings")} position="bottom" disabled={displayMenuOpened}>
          <ActionIcon variant="default" size={TOOLBAR_ACTION_SIZE} aria-label={t("photodisplay.settings")}>
            <IconSettings size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {photoOrder && <PhotoOrderSection {...photoOrder} />}
        <Menu.Label>{t("photodisplay.photoSize")}</Menu.Label>
        <Box p="xs">
          <Stack gap={6}>
            <Slider
              mb={20}
              value={localImageScale}
              onChange={onThumbnailSizeChange}
              min={0.25}
              max={3}
              step={0.05}
              marks={[
                { value: 0.5, label: "0.5" },
                { value: 1, label: "1" },
                { value: 2, label: "2" },
              ]}
            />
            <Text size="xs" c="dimmed">
              {t("photodisplay.lowerBigger")}
            </Text>
            <Text size="xs" fw={500}>
              {t("photodisplay.current", { value: localImageScale.toFixed(2) })}
            </Text>
          </Stack>
        </Box>

        <Menu.Divider />

        <Menu.Label>{t("photodisplay.textAlignment")}</Menu.Label>
        <Box p="xs">
          <Switch
            label={t("photodisplay.leftAlign")}
            checked={localTextAlignment === "left"}
            onChange={event => onTextAlignmentChange(event.currentTarget.checked ? "left" : "right")}
            size="sm"
          />
        </Box>

        <Menu.Divider />

        <Menu.Label>{t("photodisplay.headerSize")}</Menu.Label>
        <Box p="xs">
          <SegmentedControl
            size="xs"
            fullWidth
            value={localHeaderSize}
            onChange={value => {
              // The options below are the three header sizes.
              if (isHeaderSize(value)) onHeaderSizeChange(value);
            }}
            data={[
              { value: "large", label: t("photodisplay.large") },
              { value: "normal", label: t("photodisplay.normal") },
              { value: "small", label: t("photodisplay.small") },
            ]}
          />
        </Box>

        <Menu.Divider />

        <Menu.Label>{t("photodisplay.scrubberStyle")}</Menu.Label>
        <Box p="xs">
          <SegmentedControl
            size="xs"
            fullWidth
            value={localScrubberStyle}
            onChange={value => {
              if (isScrubberStyle(value)) onScrubberStyleChange(value);
            }}
            data={[
              { value: "thumb", label: t("photodisplay.scrubberThumb") },
              { value: "density", label: t("photodisplay.scrubberDensity") },
            ]}
          />
        </Box>
      </Menu.Dropdown>
    </Menu>
  );
}
