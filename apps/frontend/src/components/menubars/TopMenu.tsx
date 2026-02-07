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
  return (
    <Flex>
      <Group visibleFrom="sm" w={LEFT_MENU_WIDTH} flex="0 0 auto" p={10}>
        <TopMenuLogo />
      </Group>
      <Group wrap="nowrap" gap="xs" w="100%" px="xs" className={classes.topMenuGroup}>
        <SpotlightTrigger />
        <Group wrap="nowrap" gap="xs">
          <Box visibleFrom="sm">
            <ColorModeSwitch />
          </Box>
          <ChunkedUploadButton />
          <Box visibleFrom="sm">
            <WorkerIndicator />
          </Box>
          <Box visibleFrom="sm">
            <ProfileButton />
          </Box>
        </Group>
      </Group>
    </Flex>
  );
}
