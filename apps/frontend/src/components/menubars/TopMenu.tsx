import { Flex, Group } from "@mantine/core";
import React from "react";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { ProfileButton } from "./ProfileButton";
import { SiteSearch } from "./SiteSearch";
import { TopMenuLogo } from "./TopMenuLogo";
import { WorkerIndicator } from "./WorkerIndicator";

export function TopMenu(): React.ReactNode {
  return (
    <Flex>
      <Group visibleFrom="sm" w={LEFT_MENU_WIDTH} flex="0 0 auto" p={10}>
        <TopMenuLogo />
      </Group>
      <Group grow preventGrowOverflow={false} w="100%">
        <SiteSearch />
        <Group justify="flex-end">
          <ColorModeSwitch />
          <ChunkedUploadButton />
          <WorkerIndicator />
          <ProfileButton />
        </Group>
      </Group>
    </Flex>
  );
}
