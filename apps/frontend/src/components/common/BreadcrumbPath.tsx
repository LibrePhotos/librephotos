import { Anchor, Group, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";

type BreadcrumbPathProps = Readonly<{
  fullPath: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /**
   * A folder above the path (the library root, with either separator): only
   * the folders below it are listed, each still linking to its full path.
   * Ignored when the path is not inside it.
   */
  basePath?: string | null;
}>;

/** How many leading parts of `parts` are the base folder's; 0 when the path is not inside it. */
function basePartCount(parts: string[], basePath: string | null | undefined): number {
  const baseParts = (basePath ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (baseParts.length === 0 || baseParts.length >= parts.length) return 0;
  return baseParts.every((part, index) => part === parts[index]) ? baseParts.length : 0;
}

export function BreadcrumbPath({ fullPath, size = "xs", basePath }: BreadcrumbPathProps) {
  if (!fullPath) return null;

  const parts = fullPath.split("/").filter(Boolean);
  // POSIX paths start at "/"; Windows ones ("C:/...") must not get one added.
  const root = fullPath.startsWith("/") ? "/" : "";

  // Build cumulative paths for each part
  const breadcrumbs = parts
    .map((part, index) => ({
      label: part,
      path: root + parts.slice(0, index + 1).join("/"),
    }))
    .slice(basePartCount(parts, basePath));

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
