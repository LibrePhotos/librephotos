import { Alert, Grid, NumberInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery, useTrashRetentionPreviewQuery } from "../../api_client/settings/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { CONTROL_SPAN, SettingLabel } from "./ScanSettings";
import { useSiteSettingDraft } from "./useSiteSettingDraft";

// SiteSettingsRequest.trash_retention_days in the backend: 0 (never) to a hundred years.
const MAX_RETENTION_DAYS = 36500;

/**
 * A change that lets the cleanup delete photos it would have kept: turning the retention on, or
 * shortening it. Those ask first; lengthening it or turning it off do not.
 */
export function deletesMoreThan(stored: number, next: number): boolean {
  return next > 0 && (stored === 0 || next < stored);
}

type PreviewState = ReturnType<typeof useTrashRetentionPreviewQuery>;

/** The confirmation's second sentence: how many photos the next cleanup would delete. */
function previewSentence(preview: PreviewState, t: TFunction): string {
  if (preview.isError) return t("sitesettings.trashretentioncountfailed");
  if (!preview.data) return t("sitesettings.trashretentioncounting");
  const { photo_count: count, user_count: users } = preview.data;
  if (count === 0) return t("sitesettings.trashretentionnone");
  return t("sitesettings.trashretentionaffected", {
    count,
    users: t("sitesettings.trashretentionusers", { count: users }),
  });
}

/**
 * Days a photo stays in the trash before the daily cleanup deletes it and its original files
 * (#2203); 0, the default, never. Saved on blur and on Enter like the other fields. While it is on,
 * a red box says what it does to the files; turning it on or shortening it first asks, with the
 * number of photos the next cleanup would delete.
 */
export function TrashRetentionSetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const stored = settings?.trash_retention_days ?? 0;
  const days = useSiteSettingDraft<number | string>(stored, value => ({
    trash_retention_days: typeof value === "number" ? value : stored,
  }));
  // The value waiting for the confirmation, and the count for it.
  const [pending, setPending] = useState<number | null>(null);
  const [confirmOpen, { open, close }] = useDisclosure(false);
  const preview = useTrashRetentionPreviewQuery(confirmOpen ? pending : null);

  const commit = () => {
    // An emptied field puts back the stored value instead of saving nothing as 0.
    if (typeof days.value !== "number") {
      days.discard();
      return;
    }
    if (deletesMoreThan(stored, days.value)) {
      setPending(days.value);
      open();
      return;
    }
    void days.commit();
  };

  const cancel = () => {
    days.discard();
    close();
  };

  const confirm = () => {
    if (pending !== null) void days.commit(pending);
    close();
  };

  return (
    <>
      <SettingLabel header={t("sitesettings.headertrashretention")} description={t("sitesettings.trashretention")} />
      <Grid.Col span={CONTROL_SPAN}>
        <NumberInput
          aria-label={t("sitesettings.headertrashretention")}
          value={days.value}
          min={0}
          max={MAX_RETENTION_DAYS}
          clampBehavior="strict"
          allowDecimal={false}
          allowNegative={false}
          suffix={` ${t("sitesettings.trashretentionunit")}`}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
          }}
          onBlur={commit}
          onChange={days.edit}
        />
      </Grid.Col>
      {stored > 0 && (
        <Grid.Col span={12}>
          <Alert
            variant="light"
            color="red"
            icon={<IconAlertTriangle size={18} />}
            title={t("sitesettings.trashretentionwarningtitle")}
          >
            {t("sitesettings.trashretentionwarning", { count: stored })}
          </Alert>
        </Grid.Col>
      )}
      <ConfirmModal
        opened={confirmOpen}
        onClose={cancel}
        onConfirm={confirm}
        title={t("sitesettings.trashretentionconfirmtitle")}
        message={`${t("sitesettings.trashretentionconfirm", { count: pending ?? 0 })} ${previewSentence(preview, t)}`}
        confirmLabel={t("sitesettings.trashretentionconfirmbutton")}
        irreversible
      />
    </>
  );
}
