import { useDisclosure } from "@mantine/hooks";
import React from "react";

import { useAppDispatch } from "../store/store";

export function useSidebarToggle(initial: boolean) {
  const [sidebarVisible, { toggle: toggleSidebar }] = useDisclosure(initial);
  const dispatch = useAppDispatch();

  React.useEffect(() => {
    window.dispatchEvent(new Event("resize"));
    dispatch({ type: sidebarVisible ? "SHOW_SIDEBAR" : "HIDE_SIDEBAR" });
  }, [sidebarVisible]);

  return { sidebarVisible, toggleSidebar };
}
