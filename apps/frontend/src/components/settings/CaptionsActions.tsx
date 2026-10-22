import { IconTextCaption as TextCaption } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGenerateCaptionsMutation } from "../../api_client/jobs/hooks";
import { SplitJobSection } from "./SplitJobSection";

type CaptionsActionsProps = {
  /** Why job buttons are off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
};

/**
 * The Captions section of the Library page (#2211): caption the photos that have no generated
 * caption, or, after a confirmation, every photo again. Shown only while captioning is on.
 */
export function CaptionsActions({ busyReason }: CaptionsActionsProps) {
  const { t } = useTranslation();
  const generateCaptions = useGenerateCaptionsMutation();

  return (
    <SplitJobSection
      heading={t("settings.captions")}
      title={t("settings.captionstitle")}
      description={t("settings.captionsdescription")}
      icon={TextCaption}
      runLabel={t("settings.captionsbutton")}
      runAgainLabel={t("settings.captionsfullbutton")}
      confirm={{
        title: t("confirmdialog.captionsagain.title"),
        message: t("confirmdialog.captionsagain.message"),
        confirmLabel: t("confirmdialog.captionsagain.confirm"),
      }}
      disabledReason={busyReason}
      onRun={generateCaptions.mutate}
      loading={generateCaptions.isPending}
    />
  );
}
