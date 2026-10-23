import type { PhotoLicenseId } from "@librephotos/api-client";
import { Badge, Group } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { LICENSES } from "./photoLicenses";

/** The Creative Commons marks of a license, decorative: the name next to them says it. */
export function LicenseIcons({ license, size = 14 }: Readonly<{ license: PhotoLicenseId; size?: number }>) {
  return (
    <Group gap={2} wrap="nowrap" aria-hidden>
      {LICENSES[license].icons.map(LicenseIcon => (
        <LicenseIcon key={LicenseIcon.displayName} size={size} stroke={1.6} />
      ))}
    </Group>
  );
}

/** A license as a badge: its marks and its short name, never the marks alone (#425). */
export function LicenseBadge({ license }: Readonly<{ license: PhotoLicenseId }>) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color="gray" tt="none" leftSection={<LicenseIcons license={license} size={12} />}>
      {t(LICENSES[license].name)}
    </Badge>
  );
}
