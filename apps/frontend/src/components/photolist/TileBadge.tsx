import React from "react";

// The small filled text badge on a grid tile (RAW, HDR): one look for all of
// them, with a fill so the text stays readable on bright photos.
export function TileBadge({ style, ...props }: Readonly<React.HTMLAttributes<HTMLSpanElement>>) {
  return (
    <span
      {...props}
      style={{
        backgroundColor: "rgba(128, 128, 128, 0.85)",
        color: "white",
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 4px",
        borderRadius: 3,
        lineHeight: 1,
        ...style,
      }}
    />
  );
}
