import { IconLayersLinked, IconStack2 as Stack } from "@tabler/icons-react";
import React from "react";
import { PigPhoto } from "../../api_client/photos/types";

function RawBadge() {
  return (
    <span
      style={{
        backgroundColor: "rgba(128, 128, 128, 0.85)",
        color: "white",
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 4px",
        borderRadius: 3,
        lineHeight: 1,
      }}
    >
      RAW
    </span>
  );
}

export function StackOverlay({ item }: { item: PigPhoto }) {
  const { stacks, has_raw_variant: hasRawVariantProp } = item;

  // Check for RAW file variant (PhotoPrism-like model)
  const hasRawVariant = hasRawVariantProp === true;

  // Check for legacy RAW+JPEG stack (deprecated, for backwards compatibility)
  const isRawJpegStack = stacks && stacks.length === 1 && stacks[0].type === "raw_jpeg";

  // Show RAW badge if photo has RAW variant (new model) or is in RAW+JPEG stack (legacy)
  const showRawBadge = hasRawVariant || isRawJpegStack;

  // Filter out deprecated stack types for stack indicator
  const activeStacks = stacks?.filter(s => s.type !== "raw_jpeg" && s.type !== "live_photo") || [];
  const hasActiveStacks = activeStacks.length > 0;
  const hasMultipleActiveStacks = activeStacks.length > 1;

  // If only RAW badge to show, just show that
  if (showRawBadge && !hasActiveStacks) {
    return (
      <div style={{ display: "flex", alignItems: "center", padding: "0 0 5px 5px" }}>
        <RawBadge />
      </div>
    );
  }

  // If no RAW and no active stacks, show nothing
  if (!showRawBadge && !hasActiveStacks) {
    return null;
  }

  // Show both RAW badge and stack indicator if needed
  const Icon = hasMultipleActiveStacks ? IconLayersLinked : Stack;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, color: "white", padding: "0 0 5px 5px" }}>
      {showRawBadge && <RawBadge />}
      {hasActiveStacks && (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Icon size={18} strokeWidth={2.5} />
          {hasMultipleActiveStacks ? (
            <span style={{ marginLeft: 2, fontSize: 12, fontWeight: 600 }}>{activeStacks.length}</span>
          ) : (
            activeStacks[0].photo_count > 1 && (
              <span style={{ marginLeft: 2, fontSize: 12, fontWeight: 600 }}>{activeStacks[0].photo_count}</span>
            )
          )}
        </div>
      )}
    </div>
  );
}
