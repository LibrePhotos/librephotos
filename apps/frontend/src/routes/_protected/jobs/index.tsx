import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { JobList } from "../../../components/job/JobList";
import { PageHeader } from "../../../components/PageHeader";
import { SettingsPageFrame } from "../../../components/SettingsPageFrame";

export const Route = createFileRoute("/_protected/jobs/")({
  component: UserJobsPage,
});

function UserJobsPage() {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame header={<PageHeader title={t("jobs.header")} />}>
      {/* Non-staff are scoped to their own jobs by the backend (#1861); the
          "mine" variant additionally asks it to narrow the list for staff, so
          this page means the caller's own jobs whoever is looking. */}
      <JobList variant="mine" />
    </SettingsPageFrame>
  );
}
