import type { RightsFieldSummary, RightsSummaryResponse } from "@librephotos/api-client";
import { Button, Checkbox, Group, Modal, Skeleton, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRightsSummaryQuery, useSetPhotosRightsMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { LicenseSelect } from "./LicenseSelect";
import { changedRights } from "./RightsForm.schema";
import { initialSetRights, makeSetRightsSchema } from "./SetRightsModal.schema";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The selected photos, as the bulk photo actions name them. */
  selection: PhotoSelection;
  /** The rights were saved: the selection is done with. */
  onDone: () => void;
}>;

/**
 * "Set rights…" for the selected photos (#425): a copyright notice, a creator and a license. A field
 * the photos differ in says so and keeps each photo's value unless the user types one. Values from
 * the photos' files stay unless the user opts in.
 */
export function SetRightsModal({ opened, onClose, selection, onDone }: Props) {
  const { t } = useTranslation();
  const summary = useRightsSummaryQuery(opened ? selection : null);
  const failure = useListFailure(summary);
  const title = summary.data ? t("rights.bulk.title", { count: summary.data.count }) : t("rights.bulk.titlePending");
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      {failure && <ErrorState failure={failure} compact />}
      {summary.data && <SetRightsForm selection={selection} summary={summary.data} onClose={onClose} onDone={onDone} />}
      {!summary.data && !failure && (
        <Stack aria-busy>
          <Skeleton h={56} />
          <Skeleton h={56} />
          <Skeleton h={56} />
        </Stack>
      )}
    </Modal>
  );
}

/** What an empty field means: the photos differ (and keep theirs), or none has one yet. */
function placeholderOf(field: RightsFieldSummary, t: TFunction): string {
  return field.mixed ? t("rights.bulk.mixed") : t("rights.bulk.keep");
}

function SetRightsForm({
  selection,
  summary,
  onClose,
  onDone,
}: Readonly<{ selection: PhotoSelection; summary: RightsSummaryResponse; onClose: () => void; onDone: () => void }>) {
  const { t } = useTranslation();
  const initial = initialSetRights(summary);
  const form = useForm({
    initialValues: initial,
    validate: schemaResolver(makeSetRightsSchema(t), { sync: true }),
  });
  const { mutate, isPending } = useSetPhotosRightsMutation();
  const values = form.getValues();
  const changes = changedRights(values, initial);
  const nothingChanged = Object.keys(changes).length === 0;

  const save = form.onSubmit(submitted => {
    const rights = changedRights(submitted, initial);
    if (Object.keys(rights).length === 0) return;
    mutate(
      {
        selection,
        rights,
        keep: submitted.replaceFileValues ? "none" : "file",
      },
      {
        onSuccess: () => {
          onClose();
          onDone();
        },
      }
    );
  });

  return (
    <form onSubmit={save}>
      <Stack>
        <LicenseSelect
          value={values.license}
          onChange={value => form.setFieldValue("license", value)}
          placeholder={placeholderOf(summary.license, t)}
        />
        <TextInput
          label={t("rights.creator")}
          placeholder={placeholderOf(summary.creator, t)}
          {...form.getInputProps("creator")}
        />
        <TextInput
          label={t("rights.copyright")}
          description={t("rights.bulk.yearHint")}
          placeholder={placeholderOf(summary.copyright, t)}
          {...form.getInputProps("copyright")}
        />
        {summary.from_file > 0 && (
          <Checkbox
            label={t("rights.bulk.replaceFileValues", { count: summary.from_file })}
            description={t("rights.bulk.replaceFileValuesHint")}
            {...form.getInputProps("replaceFileValues", { type: "checkbox" })}
          />
        )}
        <WriteBackHint field="rights" />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <DisabledReason reason={nothingChanged && t("rights.bulk.nothingChanged")}>
            <Button type="submit" loading={isPending}>
              {t("rights.bulk.save", { count: summary.count })}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </form>
  );
}
