import { useDisclosure } from "@mantine/hooks";
import React from "react";

export function useSidebarToggle(initial: boolean) {
  const [sidebarVisible, { toggle: toggleSidebar }] = useDisclosure(initial);

  React.useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [sidebarVisible]);

  return { sidebarVisible, toggleSidebar };
}
