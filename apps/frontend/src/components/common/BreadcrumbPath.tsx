import { Anchor, Group, Text } from "@mantine/core";
import React from "react";

type BreadcrumbPathProps = Readonly<{
  fullPath: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}>;

export function BreadcrumbPath({ fullPath, size = "xs" }: BreadcrumbPathProps) {
  if (!fullPath) return null;

  const parts = fullPath.split("/").filter(Boolean);

  // Build cumulative paths for each part
  const breadcrumbs = parts.map((part, index) => {
    const subPath = parts.slice(0, index + 1).join("/");
    const href = `/album/folder/%2F${encodeURIComponent(subPath)}`;
    return { label: part, href };
  });

  return (
    <Group gap={4} wrap="wrap">
      {breadcrumbs.map((bc, idx) => (
        <Group key={`${bc.href}-${idx}`} gap={4} wrap="nowrap">
          <Anchor size={size} href={bc.href} underline="never">
            {bc.label}
          </Anchor>
          {idx < breadcrumbs.length - 1 && (
            <Text size={size} c="dimmed">/</Text>
          )}
        </Group>
      ))}
    </Group>
  );
}

export default BreadcrumbPath;


