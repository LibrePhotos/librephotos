import type { DateTag } from "@librephotos/api-client";
import { Button, Collapse, Group, Radio, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown as ChevronDown, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseDatePattern, readDatePattern, type DateRuleFormValues } from "./dateRuleForm";
import classes from "./RuleTable.module.css";

type FormProps = Readonly<{ form: UseFormReturnType<DateRuleFormValues> }>;

/** The tags in groups by their ExifTool group ("EXIF", "XMP", ...), marked where they usually hold UTC. */
function tagOptions(tags: readonly DateTag[], t: TFunction<"translation", undefined>) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const tag of tags) {
    const group = tag.name.split(/[:-]/)[0] ?? tag.name;
    const items = groups.get(group) ?? [];
    items.push({ value: tag.name, label: tag.utc ? t("daterules.tag_utc", { tag: tag.name }) : tag.name });
    groups.set(group, items);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** What a custom file-name pattern reads from a sample name, as the user types either. */
function DatePatternPreview({ pattern }: Readonly<{ pattern: string }>) {
  const { t } = useTranslation();
  const [sample, setSample] = useState("2023-01-01 12.00.05 (2).jpg");
  const resultId = useId();
  const parsed = parseDatePattern(pattern);
  const read = typeof parsed === "string" ? null : readDatePattern(parsed, sample);
  return (
    <Stack gap={4}>
      <TextInput
        size="xs"
        label={t("daterules.sample_label")}
        value={sample}
        onChange={event => setSample(event.currentTarget.value)}
        aria-describedby={resultId}
      />
      <Text id={resultId} size="xs" c={read ? "teal" : "dimmed"} aria-live="polite">
        {typeof parsed === "string"
          ? ""
          : read
            ? t("daterules.sample_match", { date: read })
            : t("daterules.sample_no_match")}
      </Text>
    </Stack>
  );
}

/** Where the date is read: the tag, the file name pattern or the file time, by the chosen source. */
export function DateRuleSourceFields({ form, dateTags }: FormProps & Readonly<{ dateTags: readonly DateTag[] }>) {
  const { t } = useTranslation();
  const values = form.getValues();
  switch (values.source) {
    case "exif":
      return (
        <Select
          searchable
          label={t("daterules.tag_label")}
          description={t("daterules.tag_description")}
          placeholder={t("daterules.tag_placeholder")}
          data={tagOptions(dateTags, t)}
          {...form.getInputProps("exifTag")}
          value={values.exifTag || null}
          onChange={(tag: string | null) => form.setFieldValue("exifTag", tag ?? "")}
        />
      );
    case "path":
      return (
        <Stack gap="xs">
          <Select
            label={t("daterules.pattern_label")}
            data={[
              { value: "custom", label: t("daterules.pattern_custom") },
              { value: "default", label: t("daterules.pattern_default") },
              { value: "whatsapp", label: t("daterules.pattern_whatsapp") },
            ]}
            allowDeselect={false}
            {...form.getInputProps("fileNamePattern")}
          />
          {values.fileNamePattern === "custom" && (
            <>
              <TextInput
                label={t("daterules.date_pattern_label")}
                description={t("daterules.date_pattern_description")}
                classNames={{ input: classes.patternInput }}
                {...form.getInputProps("datePattern")}
              />
              <DatePatternPreview pattern={values.datePattern} />
            </>
          )}
          <Switch label={t("daterules.full_path")} {...form.getInputProps("fullPath", { type: "checkbox" })} />
        </Stack>
      );
    case "filesystem":
      return (
        <Radio.Group label={t("daterules.file_property_label")} {...form.getInputProps("fileProperty")}>
          <Group mt={6}>
            <Radio value="mtime" label={t("daterules.file_property_mtime")} />
            <Radio value="ctime" label={t("daterules.file_property_ctime")} />
          </Group>
        </Radio.Group>
      );
  }
}

/** As recorded, or recorded in UTC and converted to the GPS zone, the default zone or a named one. */
export function DateRuleTimeZoneFields({ form, timezones }: FormProps & Readonly<{ timezones: readonly string[] }>) {
  const { t } = useTranslation();
  const values = form.getValues();
  return (
    <Stack gap="xs">
      <Radio.Group
        label={t("daterules.zone_label")}
        value={values.recordedInUtc ? "utc" : "local"}
        onChange={value => form.setFieldValue("recordedInUtc", value === "utc")}
      >
        <Stack gap={6} mt={6}>
          <Radio value="local" label={t("daterules.zone_local")} description={t("daterules.zone_local_description")} />
          <Radio value="utc" label={t("daterules.zone_utc")} description={t("daterules.zone_utc_description")} />
        </Stack>
      </Radio.Group>
      {values.recordedInUtc && (
        <Stack gap="xs" pl="xl">
          <Select
            label={t("daterules.zone_convert_to")}
            allowDeselect={false}
            data={[
              { value: "gps_timezonefinder", label: t("daterules.zone_gps") },
              { value: "user_default", label: t("daterules.zone_default") },
              { value: "named", label: t("daterules.zone_named") },
            ]}
            {...form.getInputProps("reportZone")}
          />
          {values.reportZone === "named" && (
            <Select
              searchable
              label={t("daterules.zone_name_label")}
              data={[...timezones]}
              {...form.getInputProps("zoneName")}
              value={values.zoneName || null}
              onChange={(zone: string | null) => form.setFieldValue("zoneName", zone ?? "")}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** "Only when...": the path, the file name or a tag must contain a text; folded away until asked for. */
export function DateRuleConditionFields({
  form,
  conditionTags,
}: FormProps & Readonly<{ conditionTags: readonly string[] }>) {
  const { t } = useTranslation();
  const values = form.getValues();
  const hasConditions = Boolean(values.conditionPath || values.conditionFilename || values.conditionTag);
  const [opened, { toggle }] = useDisclosure(hasConditions);
  return (
    <Stack gap="xs">
      <Button
        variant="subtle"
        size="compact-sm"
        justify="flex-start"
        leftSection={opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        aria-expanded={opened}
        onClick={toggle}
        w="fit-content"
      >
        {t("daterules.conditions_toggle")}
      </Button>
      <Collapse expanded={opened}>
        <Stack gap="xs" pl="xl">
          <TextInput label={t("daterules.condition_path")} {...form.getInputProps("conditionPath")} />
          <TextInput label={t("daterules.condition_filename")} {...form.getInputProps("conditionFilename")} />
          <Group grow align="flex-start">
            <Select
              searchable
              clearable
              label={t("daterules.condition_tag")}
              data={[...conditionTags]}
              {...form.getInputProps("conditionTag")}
              value={values.conditionTag || null}
              onChange={(tag: string | null) => form.setFieldValue("conditionTag", tag ?? "")}
            />
            <TextInput label={t("daterules.condition_tag_text")} {...form.getInputProps("conditionTagText")} />
          </Group>
        </Stack>
      </Collapse>
    </Stack>
  );
}
