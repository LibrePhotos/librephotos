import { ActionIcon, Tooltip } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import React from "react";
import type { ReactNode } from "react";

type Props = Readonly<{
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}>;

/**
 * The share button in the top right corner of an album cover. The cover's
 * container must be positioned; the click never reaches the cover's link.
 */
export function AlbumShareButton({ label, onClick, icon }: Props) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="filled"
        color="rgba(0, 0, 0, 0.5)"
        radius="sm"
        aria-label={label}
        style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
      >
        {icon ?? <IconLink size={16} color="white" />}
      </ActionIcon>
    </Tooltip>
  );
}
