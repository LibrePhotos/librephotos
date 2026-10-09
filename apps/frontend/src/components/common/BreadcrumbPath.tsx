import { Anchor, Group, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";

type BreadcrumbPathProps = Readonly<{
  fullPath: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}>;

export function BreadcrumbPath({ fullPath, size = "xs" }: BreadcrumbPathProps) {
  if (!fullPath) return null;

  const parts = fullPath.split("/").filter(Boolean);
  // POSIX paths start at "/"; Windows ones ("C:/...") must not get one added.
  const root = fullPath.startsWith("/") ? "/" : "";

  // Build cumulative paths for each part
  const breadcrumbs = parts.map((part, index) => ({
    label: part,
    path: root + parts.slice(0, index + 1).join("/"),
  }));

  return (
    <Group gap={4} wrap="wrap">
      {breadcrumbs.map((bc, idx) => (
        <Group key={`${bc.label}-${bc.path}`} gap={4} wrap="nowrap">
          <Anchor
            size={size}
            underline="never"
            // A router link, not a plain href, so opening a folder does not
            // reload the whole app. The id is encoded as the folder pages expect.
            renderRoot={props => (
              <Link to="/album/folder/$id" params={{ id: encodeURIComponent(bc.path) }} {...props} />
            )}
          >
            {bc.label}
          </Anchor>
          {idx < breadcrumbs.length - 1 && (
            <Text size={size} c="dimmed">
              /
            </Text>
          )}
        </Group>
      ))}
    </Group>
  );
}

export default BreadcrumbPath;
