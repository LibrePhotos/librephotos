import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  Code,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArrowLeft, IconBan, IconCheck, IconClock, IconRefresh } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useJobQuery } from "../../../api_client/jobs/hooks";
import { i18nResolvedLanguage } from "../../../i18n";
import { JobProgress } from "../../../components/job/JobProgress";

export const Route = createFileRoute("/_protected/admin/job/$id")();

function JobDetailView() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const jobId = parseInt(id, 10);
  const { data: job, isLoading, isError } = useJobQuery(jobId);

  if (isLoading) {
    return (
      <Container fluid>
        <Center py="xl">
          <Stack align="center" gap="md">
            <Loader size={isMobile ? "md" : "lg"} />
            <Text size={isMobile ? "sm" : "md"}>Loading job details...</Text>
          </Stack>
        </Center>
      </Container>
    );
  }

  if (isError || !job) {
    return (
      <Container fluid>
        <Center py="xl">
          <Stack align="center" gap="md">
            <Text size={isMobile ? "sm" : "md"} c="red">
              Failed to load job details
            </Text>
            <Button component={Link} to="/admin" variant="light">
              Back to Admin
            </Button>
          </Stack>
        </Center>
      </Container>
    );
  }

  const getStatusIcon = () => {
    if (job.finished) {
      return job.failed ? <IconBan color="red" size={24} /> : <IconCheck color="green" size={24} />;
    }
    return job.started_at ? <IconRefresh color="yellow" size={24} /> : <IconClock color="blue" size={24} />;
  };

  const getStatusBadge = () => {
    if (job.finished) {
      return job.failed ? (
        <Badge color="red" size="lg">
          Failed
        </Badge>
      ) : (
        <Badge color="green" size="lg">
          Completed
        </Badge>
      );
    }
    return job.started_at ? (
      <Badge color="yellow" size="lg">
        Running
      </Badge>
    ) : (
      <Badge color="blue" size="lg">
        Queued
      </Badge>
    );
  };

  const errorMessage = job.result?.error ? String(job.result.error) : null;
  const hasError = job.failed || job.result?.status === "failed" || errorMessage;

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return "N/A";
    const startTime = DateTime.fromISO(start);
    const endTime = end ? DateTime.fromISO(end) : DateTime.now();
    const duration = endTime.diff(startTime);
    const seconds = Math.floor(duration.as("seconds"));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <Container fluid p={isMobile ? "xs" : "md"}>
      <Paper shadow="sm" p={isMobile ? "xs" : "md"} radius="md">
        <Stack gap={isMobile ? "xs" : "md"}>
          {/* Header */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap="md" wrap="nowrap">
              <Button
                variant="subtle"
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => navigate({ to: "/admin" })}
              >
                Back
              </Button>
              <Group gap="xs">
                {getStatusIcon()}
                <Title size={isMobile ? "h3" : "h2"} fw={800}>
                  {t(job.job_type_str)}
                </Title>
              </Group>
            </Group>
            {getStatusBadge()}
          </Group>

          <Divider />

          {/* Job Information */}
          <Card shadow="xs" padding="md" radius="md">
            <Title order={4} mb="md">
              Job Information
            </Title>
            <Table striped highlightOnHover>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td fw={600}>Job ID</Table.Td>
                  <Table.Td>
                    <Code>{job.job_id}</Code>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>Status</Table.Td>
                  <Table.Td>{getStatusBadge()}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>Queued At</Table.Td>
                  <Table.Td>
                    {DateTime.fromISO(job.queued_at)
                      .setLocale(i18nResolvedLanguage())
                      .toLocaleString(DateTime.DATETIME_MED)}
                  </Table.Td>
                </Table.Tr>
                {job.started_at && (
                  <Table.Tr>
                    <Table.Td fw={600}>Started At</Table.Td>
                    <Table.Td>
                      {DateTime.fromISO(job.started_at)
                        .setLocale(i18nResolvedLanguage())
                        .toLocaleString(DateTime.DATETIME_MED)}
                    </Table.Td>
                  </Table.Tr>
                )}
                {job.finished_at && (
                  <Table.Tr>
                    <Table.Td fw={600}>Finished At</Table.Td>
                    <Table.Td>
                      {DateTime.fromISO(job.finished_at)
                        .setLocale(i18nResolvedLanguage())
                        .toLocaleString(DateTime.DATETIME_MED)}
                    </Table.Td>
                  </Table.Tr>
                )}
                <Table.Tr>
                  <Table.Td fw={600}>Duration</Table.Td>
                  <Table.Td>{formatDuration(job.started_at, job.finished_at)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>Started By</Table.Td>
                  <Table.Td>
                    {job.started_by.first_name || job.started_by.last_name
                      ? `${job.started_by.first_name} ${job.started_by.last_name}`.trim()
                      : job.started_by.username}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>Progress</Table.Td>
                  <Table.Td>
                    <JobProgress
                      target={job.progress_target}
                      current={job.progress_current}
                      failed={job.failed}
                      finished={job.finished}
                      result={job.result}
                      progressStep={job.progress_step}
                    />
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Card>

          {/* Error Details */}
          {hasError && (
            <Card shadow="xs" padding="md" radius="md" style={{ border: "1px solid var(--mantine-color-red-6)" }}>
              <Title order={4} mb="md" c="red">
                Error Details
              </Title>
              <Stack gap="sm">
                {errorMessage && (
                  <Box>
                    <Text fw={600} mb="xs">
                      Error Message:
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {errorMessage}
                    </Code>
                  </Box>
                )}
                {job.result && (
                  <Box>
                    <Text fw={600} mb="xs">
                      Full Result Data:
                    </Text>
                    <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "400px", overflow: "auto" }}>
                      {JSON.stringify(job.result, null, 2)}
                    </Code>
                  </Box>
                )}
              </Stack>
            </Card>
          )}

          {/* Result Data (if not an error) */}
          {!hasError && job.result && (
            <Card shadow="xs" padding="md" radius="md">
              <Title order={4} mb="md">
                Result Data
              </Title>
              <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "400px", overflow: "auto" }}>
                {JSON.stringify(job.result, null, 2)}
              </Code>
            </Card>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

Route.update({ component: JobDetailView });
