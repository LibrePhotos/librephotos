import { Box, Flex, Group } from "@mantine/core";
import React from "react";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { SpotlightTrigger } from "../spotlight";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { ProfileButton } from "./ProfileButton";
import classes from "./TopMenu.module.css";
import { TopMenuLogo } from "./TopMenuLogo";
import { WorkerIndicator } from "./WorkerIndicator";

export function TopMenu(): React.ReactNode {
  // Centre both groups in the header instead of nudging them with margins, so
  // the search field and the 30px tiles share one midline.
  return (
    <Flex h="100%" align="center">
      <Group visibleFrom="sm" w={LEFT_MENU_WIDTH} flex="0 0 auto" px={10}>
        <TopMenuLogo />
      </Group>
      <Group wrap="nowrap" gap="xs" w="100%" px="xs" className={classes.topMenuGroup}>
        <SpotlightTrigger />
        {/* display: flex on the wrappers, so each tile is centred itself rather
            than sitting on a text baseline (the avatar sat 3px higher). */}
        <Group wrap="nowrap" gap="xs">
          <Box visibleFrom="sm" display="flex">
            <ColorModeSwitch />
          </Box>
          <ChunkedUploadButton />
          <Box visibleFrom="sm" display="flex">
            <WorkerIndicator />
          </Box>
          <Box visibleFrom="sm" display="flex">
            <ProfileButton />
          </Box>
        </Group>
      </Group>
    </Flex>
  );
}
