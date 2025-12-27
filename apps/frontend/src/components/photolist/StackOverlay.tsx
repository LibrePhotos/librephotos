import { IconLayersLinked, IconStack2 as Stack } from "@tabler/icons-react";
import React from "react";
import { PigPhoto } from "../../api_client/photos/types";

export function StackOverlay({ item }: { item: PigPhoto }) {
  // Only show stack icon if photo is part of any stacks
  const { stacks } = item;
  if (!stacks || stacks.length === 0) {
    return null;
  }

  const hasMultipleStacks = stacks.length > 1;

  // If photo is in multiple stacks, show a special indicator
  const Icon = hasMultipleStacks ? IconLayersLinked : Stack;

  return (
    <div style={{ display: "flex", alignItems: "center", color: "white", padding: "0 5px 5px 0" }}>
      <Icon size={18} strokeWidth={2.5} />
      {hasMultipleStacks ? (
        <span style={{ marginLeft: 2, fontSize: 12, fontWeight: 600 }}>{stacks.length}</span>
      ) : (
        stacks[0].photo_count > 1 && (
          <span style={{ marginLeft: 2, fontSize: 12, fontWeight: 600 }}>{stacks[0].photo_count}</span>
        )
      )}
    </div>
  );
}
