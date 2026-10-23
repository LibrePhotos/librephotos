import type { PhotoRightsUpdate, RightsField } from "@librephotos/api-client";
import { ActionIcon, Badge, Group, Stack, TextInput, Tooltip } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconCheck, IconX } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { UnsavedBadge } from "../lightbox/UnsavedBadge";
import { useRegisterDraft } from "../lightbox/unsavedDrafts";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { LicenseSelect } from "./LicenseSelect";
import { changedRights, makeRightsFormSchema, type RightsFormValues } from "./RightsForm.schema";

/** Says that a value is the one the photo's file gives, not one set in LibrePhotos. */
export function FromFileBadge() {
  const { t } = useTranslation();
  return (
    <Badge size="xs" variant="outline" color="gray" tt="none">
      {t("rights.fromFile")}
    </Badge>
  );
}

function FieldLabel({ label, fromFile }: Readonly<{ label: string; fromFile: boolean }>) {
  return (
    <Group gap={6} component="span" wrap="nowrap">
      {label}
      {fromFile && <FromFileBadge />}
    </Group>
  );
}

type Props = Readonly<{
  /** The rights when the editor opened. */
  saved: RightsFormValues;
  /** The fields whose saved value is the file's. */
  fromFile: readonly RightsField[];
  saving: boolean;
  /** Called with the changed fields only; never with none. */
  onSave: (update: PhotoRightsUpdate) => void;
  onCancel: () => void;
  heading: React.ReactNode;
}>;

/** The rights editor of the info panel (#425): copyright, creator and license, saved together. */
export function RightsForm({ saved, fromFile, saving, onSave, onCancel, heading }: Props) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: saved,
    validate: schemaResolver(makeRightsFormSchema(t), { sync: true }),
  });
  const dirty = Object.keys(changedRights(form.getValues(), saved)).length > 0;
  useRegisterDraft("rights", dirty);

  const save = form.onSubmit(values => {
    const update = changedRights(values, saved);
    // An unchanged editor is a Cancel, not an edit-history entry.
    if (Object.keys(update).length === 0) onCancel();
    else onSave(update);
  });

  return (
    <form onSubmit={save}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {heading}
            {dirty && <UnsavedBadge />}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={t("lightbox.sidebar.cancel")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("lightbox.sidebar.cancel")}
                onClick={onCancel}
              >
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("lightbox.sidebar.save")}>
              <ActionIcon
                type="submit"
                variant="subtle"
                color="blue"
                size="sm"
                aria-label={t("lightbox.sidebar.save")}
                loading={saving}
              >
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <TextInput
          label={<FieldLabel label={t("rights.copyright")} fromFile={fromFile.includes("copyright")} />}
          placeholder={t("rights.copyrightPlaceholder")}
          {...form.getInputProps("copyright")}
        />
        <TextInput
          label={<FieldLabel label={t("rights.creator")} fromFile={fromFile.includes("creator")} />}
          {...form.getInputProps("creator")}
        />
        <LicenseSelect
          label={<FieldLabel label={t("rights.license")} fromFile={fromFile.includes("license")} />}
          value={form.getValues().license}
          onChange={value => form.setFieldValue("license", value)}
        />
        <WriteBackHint field="rights" />
      </Stack>
    </form>
  );
}
