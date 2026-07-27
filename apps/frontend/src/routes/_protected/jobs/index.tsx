import { Container, Group, Space, Stack, Title } from "@mantine/core";
import { IconListDetails as ListDetails } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { JobList } from "../../../components/job/JobList";

export const Route = createFileRoute("/_protected/jobs/")();

function UserJobsPage() {
  const { t } = useTranslation();

  return (
    <Container>
      <Stack>
        <Group gap="xs" mt={40} mb={20}>
          <ListDetails size={35} />
          <Title order={1}>{t("jobs.header")}</Title>
        </Group>

        {/* Non-staff are scoped to their own jobs by the backend (#1861); the
            "mine" variant additionally asks it to narrow the list for staff, so
            this page means the caller's own jobs whoever is looking. */}
        <JobList variant="mine" />

        <Space h="xl" />
      </Stack>
    </Container>
  );
}

Route.update({ component: UserJobsPage });
