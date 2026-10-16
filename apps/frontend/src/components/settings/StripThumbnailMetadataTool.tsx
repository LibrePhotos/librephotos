import React from "react";
import { useTranslation } from "react-i18next";
import { useStripThumbnailMetadataMutation } from "../../api_client/jobs/hooks";
import { AdminJobTool } from "./AdminJobTool";

// LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA in the backend.
const STRIP_THUMBNAIL_METADATA_JOB_TYPE = 23;

/**
 * Admin Tools row that starts the thumbnail metadata cleanup (#2321), the job behind
 * `manage.py strip_thumbnail_metadata`. While it runs, the row says how far it got and links to it.
 */
export function StripThumbnailMetadataTool({ buttonWidth }: Readonly<{ buttonWidth: number }>) {
  const { t } = useTranslation();
  const { mutate: start, isPending } = useStripThumbnailMetadataMutation();

  return (
    <AdminJobTool
      jobType={STRIP_THUMBNAIL_METADATA_JOB_TYPE}
      title={t("adminarea.stripthumbnailmetadata")}
      explanation={t("adminarea.stripthumbnailmetadataexplanation")}
      buttonWidth={buttonWidth}
      isPending={isPending}
      onStart={() => start()}
    />
  );
}
