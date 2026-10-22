import { Button, Card, Container, Flex, Group, Modal, Space, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAdjustments as Adjustments, IconLock as Lock, IconTrash as Trash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAllAutoAlbumsMutation } from "../../api_client/albums/hooks";
import { useUpgradeTasksQuery } from "../../api_client/jobs/hooks/useUpgradeTasks";
import { useFetchServerStatsQuery, useUpdateNotice } from "../../api_client/server/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { EmptyState } from "../common/EmptyState";
import { PageLoader } from "../common/PageLoader";
import { JobList } from "../job/JobList";
import { PageHeader } from "../PageHeader";
import { AdminUserTable } from "./AdminUserTable";
import { CheckFileContentsTool } from "./CheckFileContentsTool";
import { DeduplicateFacesTool } from "./DeduplicateFacesTool";
import { EmailSettings } from "./EmailSettings";
import { FeaturesCard } from "./FeaturesCard";
import { FinishUpgradeCard } from "./FinishUpgradeCard";
import { LookUpPlacesTool } from "./LookUpPlacesTool";
import { ADMIN_SECTIONS } from "./sectionIds";
import { SectionNav } from "./SectionNav";
import { ServerLogsCard } from "./ServerLogsCard";
import { ServiceList } from "./ServiceList";
import { SectionLink, SettingsSection } from "./SettingsSection";
import { SiteSettings } from "./SiteSettings";
import { StripThumbnailMetadataTool } from "./StripThumbnailMetadataTool";
import { UpdateAvailableCard } from "./UpdateAvailableCard";

const ADMIN_TOOL_MIN_WIDTH = 120;

function AdminTools() {
  const { t } = useTranslation();
  const { data: serverStats, isLoading } = useFetchServerStatsQuery();
  const { mutate: deleteAllAutoAlbums, isPending } = useDeleteAllAutoAlbumsMutation();
  // Deleting drops every event album of this admin together with its favourite and sharing
  // state, which regenerating cannot bring back, so ask first.
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const downloadFile = () => {
    // create file in browser
    const fileName = "serverstats";
    const json = JSON.stringify(serverStats, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);

    // create "a" HTLM element with href to file
    const link = document.createElement("a");
    link.href = href;
    link.download = `${fileName}.json`;
    document.body.appendChild(link);
    link.click();

    // clean up "a" element & remove ObjectURL
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  };

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4}>
          {t("adminarea.admintools")}
          <SectionLink />
        </Title>
        <Flex justify="space-between" align="center" gap="md">
          <Text>{t("adminarea.deleteallautoalbums")}</Text>
          <Button
            color="red"
            variant="outline"
            leftSection={<Trash size={16} />}
            miw={ADMIN_TOOL_MIN_WIDTH}
            loading={isPending}
            onClick={openConfirm}
          >
            {t("adminarea.delete")}
          </Button>
        </Flex>
        <Flex justify="space-between" align="center" gap="md">
          <Text>{t("adminarea.downloadserverstats")}</Text>
          <Button miw={ADMIN_TOOL_MIN_WIDTH} loading={isLoading} onClick={() => downloadFile()}>
            {t("adminarea.download")}
          </Button>
        </Flex>
        <StripThumbnailMetadataTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
        <LookUpPlacesTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
        <DeduplicateFacesTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
        <CheckFileContentsTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
      </Stack>
      <Modal
        opened={confirmOpen}
        onClose={closeConfirm}
        centered
        // The modal title is already an h2; a span keeps the heading look without nesting headings.
        title={
          <Text component="span" fw={700} size="lg">
            {t("adminarea.deleteallautoalbums")}
          </Text>
        }
      >
        <Stack>
          <Text size="sm">{t("adminarea.deleteallautoalbumsexplanation")}</Text>
          <Text size="sm" c="red">
            {t("adminarea.cannotbeundone")}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              loading={isPending}
              onClick={() => deleteAllAutoAlbums(undefined, { onSettled: closeConfirm })}
            >
              {t("adminarea.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

export function AdminPage() {
  // isPending, not isLoading: the query stays disabled until the access token resolves, and a
  // disabled query is not "loading", which used to flash the unauthorized state for admins.
  const { data: currentUser, isPending } = useCurrentUserSelfDetailsQuery();
  const { t } = useTranslation();
  // The card heads the page while an update left something to do (#2322).
  const upgradeTasks = useUpgradeTasksQuery({ enabled: currentUser?.is_superuser === true }).data?.tasks ?? [];
  // A newer release is out (#2311), unless skipped or closed this week.
  const update = useUpdateNotice(currentUser?.is_superuser === true);

  if (isPending) {
    return <PageLoader />;
  }

  if (!currentUser?.is_superuser) {
    return (
      <EmptyState
        icon={<Lock size={40} />}
        title={t("adminarea.unauthorized")}
        description={t("adminarea.unauthorizeddescription")}
        actionLabel={t("publicalbum.goHome")}
        actionLink="/"
      />
    );
  }

  const sections = [
    ...(update ? [{ id: ADMIN_SECTIONS.update, label: t("updates.header") }] : []),
    ...(upgradeTasks.length ? [{ id: ADMIN_SECTIONS.upgrade, label: t("upgradetasks.header") }] : []),
    { id: ADMIN_SECTIONS.site, label: t("adminarea.sitesettings") },
    { id: ADMIN_SECTIONS.features, label: t("sitesettings.features_header") },
    { id: ADMIN_SECTIONS.email, label: t("emailsettings.header") },
    { id: ADMIN_SECTIONS.tools, label: t("adminarea.admintools") },
    { id: ADMIN_SECTIONS.logs, label: t("adminarea.serverlogs") },
    { id: ADMIN_SECTIONS.services, label: t("services.header") },
    { id: ADMIN_SECTIONS.users, label: t("adminarea.users") },
    { id: ADMIN_SECTIONS.jobs, label: t("joblist.workerlogs") },
  ];

  return (
    <Container size="lg">
      {/* Outside the Stack, so the first card starts where it does on the other settings pages. */}
      <PageHeader icon={Adjustments} title={t("adminarea.header")} />
      <SectionNav sections={sections}>
        <Stack>
          {update ? (
            <SettingsSection id={ADMIN_SECTIONS.update}>
              <UpdateAvailableCard status={update} />
            </SettingsSection>
          ) : null}
          {upgradeTasks.length ? (
            <SettingsSection id={ADMIN_SECTIONS.upgrade}>
              <FinishUpgradeCard tasks={upgradeTasks} />
            </SettingsSection>
          ) : null}
          <SettingsSection id={ADMIN_SECTIONS.site}>
            <SiteSettings />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.features}>
            <FeaturesCard />
          </SettingsSection>
          {/* Anchors itself (admin-email). */}
          <EmailSettings />
          <SettingsSection id={ADMIN_SECTIONS.tools}>
            <AdminTools />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.logs}>
            <ServerLogsCard />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.services}>
            <ServiceList />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.users}>
            <AdminUserTable />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.jobs}>
            <JobList />
          </SettingsSection>
          <Space h="xl" />
        </Stack>
      </SectionNav>
    </Container>
  );
}
