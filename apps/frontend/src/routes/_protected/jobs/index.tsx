import { Container, Space, Stack } from "@mantine/core";
import { IconListDetails as ListDetails } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { JobList } from "../../../components/job/JobList";
import { PageHeader } from "../../../components/PageHeader";

export const Route = createFileRoute("/_protected/jobs/")({
  component: UserJobsPage,
});

function UserJobsPage() {
  const { t } = useTranslation();

  return (
    <Container>
      {/* Outside the Stack and with the same offsets as Settings, Profile, Library and Admin. */}
      <PageHeader icon={ListDetails} title={t("jobs.header")} />
      <Stack>
        {/* Non-staff are scoped to their own jobs by the backend (#1861); the
            "mine" variant additionally asks it to narrow the list for staff, so
            this page means the caller's own jobs whoever is looking. */}
        <JobList variant="mine" />

        <Space h="xl" />
      </Stack>
    </Container>
  );
}
