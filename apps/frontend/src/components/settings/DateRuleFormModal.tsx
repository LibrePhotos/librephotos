import { serverFieldErrors, type DateRuleOptions, type DateTimeRule } from "@librephotos/api-client";
import { Alert, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm, type UseFormReturnType } from "@mantine/form";
import React, { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCheckDateRuleMutation } from "../../api_client/settings/hooks/useCheckDateRuleMutation";
import { useDateRuleOptionsQuery } from "../../api_client/settings/hooks/useDateRuleOptionsQuery";
import { useFetchTimezonesQuery } from "../../api_client/settings/hooks/useFetchTimezonesQuery";
import { DisabledReason } from "../common/DisabledReason";
import { PageLoader } from "../common/PageLoader";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { DateRuleConditionFields, DateRuleSourceFields, DateRuleTimeZoneFields } from "./DateRuleFields";
import { formValuesToRule, suggestedName, type DateRuleFormValues, type RuleSource } from "./dateRuleForm";
import { makeDateRuleFormSchema } from "./DateRuleFormModal.schema";

/** What the form opens with: the values, the id the rule is saved under, and whether it edits one. */
export type DateRuleDraft = Readonly<{ values: DateRuleFormValues; id: number; editing: boolean }>;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  draft: DateRuleDraft | null;
  /** The checked rule, to put into the list (the settings save stores it). */
  onSave: (rule: DateTimeRule) => void;
}>;

// The rule param a 400 names -> the form field that shows its message.
const SERVER_FIELDS: Partial<Record<string, keyof DateRuleFormValues>> = {
  exif_tag: "exifTag",
  date_pattern: "datePattern",
  file_property: "fileProperty",
  report_tz: "zoneName",
  condition_path: "conditionPath",
  condition_filename: "conditionFilename",
  condition_exif: "conditionTagText",
  name: "name",
};

const SOURCES: readonly RuleSource[] = ["exif", "path", "filesystem"];

/** Shows each refused param next to its field; returns the messages no field can show. */
function showServerErrors(form: UseFormReturnType<DateRuleFormValues>, error: unknown): string[] {
  const unplaced: string[] = [];
  for (const { field, message } of serverFieldErrors(error)) {
    const formField = SERVER_FIELDS[field];
    if (formField) form.setFieldError(formField, message);
    else unplaced.push(message);
  }
  return unplaced;
}

/** Keeps the name on what the choices suggest until the user writes one of their own. */
function useSuggestedName(form: UseFormReturnType<DateRuleFormValues>) {
  const { t } = useTranslation();
  const suggestion = suggestedName(form.getValues(), t);
  const previous = useRef(suggestion);
  const follow = useEffectEvent((next: string) => {
    const { name } = form.getValues();
    if (!name || name === previous.current) form.setFieldValue("name", next);
    previous.current = next;
  });
  useEffect(() => follow(suggestion), [suggestion]);
}

type FormProps = Readonly<{ draft: DateRuleDraft; options: DateRuleOptions } & Omit<Props, "opened" | "draft">>;

function DateRuleForm({ draft, options, onClose, onSave }: FormProps) {
  const { t } = useTranslation();
  const { data: timezones } = useFetchTimezonesQuery();
  const dateTags = options.date_tags;
  const form = useForm({
    initialValues: draft.values,
    validate: schemaResolver(
      makeDateRuleFormSchema(
        t,
        dateTags.map(tag => tag.name)
      ),
      { sync: true }
    ),
    validateInputOnChange: ["datePattern"],
  });
  useSuggestedName(form);
  const check = useCheckDateRuleMutation({ reportsErrors: true });
  const [checkError, setCheckError] = useState<string | null>(null);
  const sourceLabelId = useId();

  const save = form.onSubmit(values => {
    const rule = formValuesToRule(values, draft.id);
    setCheckError(null);
    check.mutate(rule, {
      onSuccess: () => {
        onSave(rule);
        onClose();
      },
      onError: error => {
        const unplaced = showServerErrors(form, error);
        const placed = serverFieldErrors(error).length > unplaced.length;
        setCheckError(unplaced.length ? unplaced.join(" ") : placed ? null : t("daterules.check_failed"));
      },
    });
  });

  const values = form.getValues();
  return (
    <form onSubmit={save}>
      <Stack gap="md">
        <Stack gap={4}>
          <Text id={sourceLabelId} size="sm" fw={500}>
            {t("daterules.source_label")}
          </Text>
          <SegmentedControl
            fullWidth
            aria-labelledby={sourceLabelId}
            data={[
              { value: "exif", label: t("daterules.source_exif") },
              { value: "path", label: t("daterules.source_path") },
              { value: "filesystem", label: t("daterules.source_filesystem") },
            ]}
            value={values.source}
            onChange={source => form.setFieldValue("source", SOURCES.find(s => s === source) ?? "exif")}
          />
        </Stack>
        <DateRuleSourceFields form={form} dateTags={dateTags} />
        <DateRuleTimeZoneFields form={form} timezones={timezones ?? []} />
        <DateRuleConditionFields form={form} conditionTags={options.condition_tags} />
        <TextInput label={t("daterules.name_label")} {...form.getInputProps("name")} />
        {checkError && (
          <Alert color="red" role="alert">
            {checkError}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <DisabledReason reason={!form.isValid() && t("daterules.fix_fields")}>
            <Button type="submit" loading={check.isPending}>
              {t("daterules.save")}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </form>
  );
}

/** The form, once the tags a rule may use are known: its checks need them. */
function DateRuleFormLoader(props: Omit<FormProps, "options">) {
  const { data: options } = useDateRuleOptionsQuery();
  return options ? <DateRuleForm {...props} options={options} /> : <PageLoader />;
}

/**
 * A custom date rule (#2272): where the date is read, which time zone it is in and when the rule
 * applies. Save asks the server whether the rule can be saved and shows its answer next to the
 * fields; the rule then joins the list, which the settings save stores.
 */
export function DateRuleFormModal({ opened, onClose, draft, onSave }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      onClose={onClose}
      size="lg"
      title={draft?.editing ? t("daterules.form_title_edit") : t("daterules.form_title_new")}
    >
      {opened && draft && <DateRuleFormLoader draft={draft} onClose={onClose} onSave={onSave} />}
    </Modal>
  );
}
