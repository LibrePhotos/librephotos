import { PhotoLicenseId } from "@librephotos/api-client";
import { Group, Select, Stack, Text, type ComboboxItem } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { LicenseIcons } from "./LicenseBadge";
import { asLicense, LICENSE_GROUP_KEYS, LICENSES, type LicenseGroup } from "./photoLicenses";

type Props = Readonly<{
  value: PhotoLicenseId | null;
  onChange: (value: PhotoLicenseId | null) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** What an empty field means here: no license, or "keep each photo's" in a bulk dialog. */
  placeholder?: string;
}>;

const GROUPS: readonly LicenseGroup[] = ["reserved", "creativeCommons", "publicDomain"];

/** One option: the marks, the short name and the full name. */
function LicenseOption({ option }: Readonly<{ option: ComboboxItem }>) {
  const { t } = useTranslation();
  const license = asLicense(option.value);
  if (!license) return option.label;
  return (
    <Group gap="sm" wrap="nowrap">
      <LicenseIcons license={license} size={16} />
      <Stack gap={0}>
        <Text size="sm">{t(LICENSES[license].name)}</Text>
        <Text size="xs" c="dimmed">
          {t(LICENSES[license].title)}
        </Text>
      </Stack>
    </Group>
  );
}

/**
 * The license picker (#425): the fixed list, grouped into all rights reserved, Creative Commons and
 * public domain. Empty is no license (or what `placeholder` says).
 */
export function LicenseSelect({ value, onChange, label, description, placeholder }: Props) {
  const { t } = useTranslation();
  const data = GROUPS.map(group => ({
    group: t(LICENSE_GROUP_KEYS[group]),
    items: PhotoLicenseId.options
      .filter(id => LICENSES[id].group === group)
      .map(id => ({ value: id, label: t(LICENSES[id].name) })),
  }));
  return (
    <Select
      label={label ?? t("rights.license")}
      description={description}
      placeholder={placeholder ?? t("rights.noLicense")}
      data={data}
      value={value}
      onChange={next => onChange(asLicense(next))}
      renderOption={input => <LicenseOption option={input.option} />}
      leftSection={value ? <LicenseIcons license={value} /> : undefined}
      leftSectionWidth={value ? LICENSES[value].icons.length * 14 + 16 : undefined}
      clearable
      allowDeselect
      comboboxProps={{ withinPortal: true }}
    />
  );
}
