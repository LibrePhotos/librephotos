import { HoverCard, Stack, Text } from "@mantine/core";
import { t } from "i18next";
import React, { useEffect, useState } from "react";

import { FacesTab } from "../../api_client/faces";
import { useFetchFacesQuery } from "../../api_client/faces/hooks/useFetchFacesQuery";
import { FacesOrderOption, FaceAnalysisMethod, CompletePersonFaceList } from "../../api_client/faces/types";

type Props = Readonly<{
  tab: FacesTab;
  children: React.ReactNode;
}>;

export function FacesCountersHoverCard({ tab, children }: Props) {
  
  

  return (
    <HoverCard shadow="md" openDelay={500}>
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>{5}</HoverCard.Dropdown>
    </HoverCard>
  );
}
