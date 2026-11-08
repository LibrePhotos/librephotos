import { Anchor, Button, Divider, Group, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBug, IconLock, IconSend, IconTrash } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteAllErrorReportsMutation,
  useErrorReportsQuery,
  useSendAllErrorReportsMutation,
} from "../../api_client/errorReports";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ICON_SIZE } from "../../uiConstants";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { ConfirmModal } from "../modals/ConfirmModal";
import { PageHeader } from "../PageHeader";
import { ADMIN_SECTIONS } from "../settings/sectionIds";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsPageFrame } from "../SettingsPageFrame";
import { EmailHint, ErrorReportRow } from "./ErrorReportRow";
import { useSendAllToast } from "./useSendAllToast";

function ReportList() {
  const { t } = useTranslation();
  const query = useErrorReportsQuery({ enabled: true });
  const listFailure = useListFailure(query);
  const sendAll = useSendAllErrorReportsMutation();
  const sendAllToast = useSendAllToast();
  const deleteAll = useDeleteAllErrorReportsMutation();
  const [confirmOpen, { open, close }] = useDisclosure(false);

  if (query.isPending) return <PageLoader />;
  if (listFailure) return <ErrorState failure={listFailure} />;
  const reports = query.data ?? [];
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={<IconBug size={40} />}
        title={t("errorreports.empty_title")}
        description={t("errorreports.empty_description")}
      />
    );
  }
  const unsent = reports.filter(report => report.sent_at === null).length;

  return (
    <SettingsCard>
      <Stack gap={0}>
        <Group justify="space-between" pb="xs">
          <Text fz="sm" c="dimmed">
            {t("errorreports.unsent", { count: unsent })}
          </Text>
          <Group gap="xs">
            {unsent > 0 ? (
              <Button
                size="xs"
                leftSection={<IconSend size={ICON_SIZE.menu} />}
                loading={sendAll.isPending}
                onClick={() => sendAll.mutate(undefined, sendAllToast)}
              >
                {t("errorreports.send_all")}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={ICON_SIZE.menu} />}
              onClick={open}
            >
              {t("errorreports.delete_all")}
            </Button>
          </Group>
        </Group>
        {/* At most 30: the server keeps no more. */}
        {reports.map((report, index) => (
          <Fragment key={report.id}>
            {index > 0 ? <Divider /> : null}
            <ErrorReportRow report={report} />
          </Fragment>
        ))}
        <Divider mb="xs" />
        <EmailHint />
      </Stack>
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={() => deleteAll.mutate(undefined, { onSuccess: close })}
        loading={deleteAll.isPending}
        title={t("errorreports.delete_all_title")}
        message={t("errorreports.delete_all_message")}
        confirmLabel={t("errorreports.delete_all")}
        irreversible
      />
    </SettingsCard>
  );
}

/**
 * The Error reports page (#2938, admins): the saved reports with Send once, Download, Email and
 * Delete for each, and Send all and Delete all. These work whatever the Error reporting setting
 * says; it only decides whether new reports are sent by themselves.
 */
export function ErrorReportsPage() {
  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  if (!currentUser?.is_superuser) {
    return (
      <EmptyState
        icon={<IconLock size={40} />}
        title={t("adminarea.unauthorized")}
        description={t("adminarea.unauthorizeddescription")}
        actionLabel={t("publicalbum.goHome")}
        actionLink="/"
      />
    );
  }
  return (
    <SettingsPageFrame header={<PageHeader title={t("errorreports.page_title")} />}>
      <Stack>
        <Text fz="sm" c="dimmed" maw="72ch">
          {t("errorreports.page_description")}{" "}
          <Anchor component={Link} to="/admin" hash={ADMIN_SECTIONS.errors} fz="sm">
            {t("errorreports.settings_link")}
          </Anchor>
        </Text>
        <ReportList />
      </Stack>
    </SettingsPageFrame>
  );
}
