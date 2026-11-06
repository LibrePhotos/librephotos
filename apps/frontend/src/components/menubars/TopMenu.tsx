import { Box, Flex, Group } from "@mantine/core";
import React from "react";
import { LEFT_MENU_WIDTH, PAGE_GUTTER } from "../../uiConstants";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { SpotlightTrigger } from "../spotlight";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { MobileBackButton } from "./MobileBackButton";
import { ProfileButton } from "./ProfileButton";
import classes from "./TopMenu.module.css";
import { TopMenuLogo } from "./TopMenuLogo";

export function TopMenu(): React.ReactNode {
  // Centre both groups in the header instead of nudging them with margins, so
  // the search field and the 30px tiles share one midline.
  return (
    <Flex h="100%" align="center">
      {/* The logo on the sidebar's icon column (its rows' 10px margin plus 16px padding). */}
      <Group visibleFrom="sm" w={LEFT_MENU_WIDTH} flex="0 0 auto" pl={26} pr={10}>
        <TopMenuLogo />
      </Group>
      {/* The search field starts on the page content's left edge (the page gutter). */}
      <Group
        wrap="nowrap"
        gap="xs"
        w="100%"
        pl={{ base: "xs", sm: PAGE_GUTTER }}
        pr="xs"
        className={classes.topMenuGroup}
      >
        <MobileBackButton />
        <SpotlightTrigger />
        {/* display: flex on the wrappers, so each tile is centred itself rather
            than sitting on a text baseline (the avatar sat 3px higher). */}
        <Group wrap="nowrap" gap="xs">
          <Box visibleFrom="sm" display="flex">
            <ColorModeSwitch />
          </Box>
          <ChunkedUploadButton />
          <Box visibleFrom="sm" display="flex">
            <ProfileButton />
          </Box>
        </Group>
      </Group>
    </Flex>
  );
}
