import { Group, RenderTreeNodePayload } from "@mantine/core";
import { IconFolder, IconFolderOpen } from "@tabler/icons-react";
import React from "react";

function FileIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <IconFolderOpen color="var(--mantine-color-yellow-9)" size={14} stroke={2.5} />
  ) : (
    <IconFolder color="var(--mantine-color-yellow-9)" size={14} stroke={2.5} />
  );
}

type LeafType = RenderTreeNodePayload & {
  nodeClicked?: (node: { value: string }) => void;
};

export function Leaf({ node, expanded, elementProps, nodeClicked = () => {} }: LeafType) {
  return (
    <Group
      gap={5}
      {...elementProps}
      onClick={event => {
        elementProps.onClick(event);
        nodeClicked(node);
      }}
    >
      <FileIcon expanded={expanded} />
      <span>{node.label}</span>
    </Group>
  );
}
