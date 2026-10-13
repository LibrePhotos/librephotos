import { serviceKeys } from "@librephotos/api-client";
import { ActionIcon, Badge, Button, Card, Group, Loader, Table, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlayerPlay as Play, IconRefresh as Refresh, IconPlayerStop as Stop } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "../../api_client/api";
import { useServiceActionMutation } from "../../api_client/services/hooks/useServiceActionMutation";
import { useServicesHealthQuery, useServicesListQuery } from "../../api_client/services/hooks/useServicesQuery";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { ConfirmModal } from "../modals/ConfirmModal";
import { serviceLabel } from "./serviceLabel";
import { SectionLink } from "./SettingsSection";

// English names; t("services.label_<name>") translates them, and a service the frontend does not
// know yet shows its raw name.
export function ServiceList() {
  const { t } = useTranslation();
  const servicesQuery = useServicesListQuery();
  const { data: servicesList, isLoading: isLoadingList } = servicesQuery;
  const listFailure = useListFailure(servicesQuery);

  const serviceNames = servicesList ? Object.keys(servicesList.services) : [];
  const { data: healthMap, isLoading: isLoadingHealth } = useServicesHealthQuery(serviceNames, {
    enabled: serviceNames.length > 0,
  });

  const { mutate: performAction, isPending, variables: pendingAction } = useServiceActionMutation();

  const isLoading = isLoadingList || isLoadingHealth;

  // Stopping takes a feature away from every user of the server, so it asks first.
  const [stopOpened, stopDialog] = useDisclosure(false);
  const [serviceToStop, setServiceToStop] = useState("");
  const askToStop = (name: string) => {
    setServiceToStop(name);
    stopDialog.open();
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: serviceKeys.healths() });
  };

  return (
    <Card shadow="md">
      <Group justify="space-between" mb={16}>
        <Group gap="xs">
          <Title order={4}>
            {t("services.header")}
            <SectionLink />
          </Title>
          {isLoading && <Loader size="xs" />}
        </Group>
        {/* Same bordered icon button as the Server Logs download, flush with the table edge. */}
        <Tooltip label={t("services.refresh")}>
          <ActionIcon
            variant="default"
            size="md"
            onClick={handleRefresh}
            loading={isLoadingHealth}
            aria-label={t("services.refresh")}
          >
            <Refresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Table.ScrollContainer minWidth={300} type="native">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("services.name")}</Table.Th>
              {/* The port matters for debugging, not on a phone, where it squeezed the status badges. */}
              <Table.Th visibleFrom="sm">{t("services.port")}</Table.Th>
              <Table.Th>{t("services.status")}</Table.Th>
              <Table.Th>{t("services.actions")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {servicesList &&
              Object.entries(servicesList.services).map(([name, port]) => {
                const health = healthMap?.[name];
                const healthy = health?.healthy;
                const disabled = health?.enabled === false;
                const isThisServicePending = isPending && pendingAction?.serviceName === name;

                return (
                  <Table.Tr key={name}>
                    <Table.Td>{serviceLabel(name, t)}</Table.Td>
                    <Table.Td visibleFrom="sm">{port}</Table.Td>
                    <Table.Td>
                      {healthMap === undefined && <Loader size="xs" />}
                      {healthMap !== undefined && disabled && (
                        <Tooltip
                          label={
                            health?.feature_flag
                              ? t("services.disabled_by", { flag: health.feature_flag })
                              : t("services.disabled_hint")
                          }
                        >
                          <Badge color="gray" variant="light" style={{ minWidth: "max-content" }}>
                            {t("services.disabled")}
                          </Badge>
                        </Tooltip>
                      )}
                      {healthMap !== undefined && !disabled && (
                        <Badge color={healthy ? "green" : "red"} variant="filled" style={{ minWidth: "max-content" }}>
                          {healthy ? t("services.healthy") : t("services.unhealthy")}
                        </Badge>
                      )}
                      {/* Visible rather than in a tooltip: the admin has to act on it, also on a phone. */}
                      {!disabled && !healthy && health?.port_conflict && (
                        <Text size="xs" c="red" mt={4} maw={260}>
                          {t("services.cannot_start", { reason: health.port_conflict })}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {/* As tall as an xs button even when empty, so the striped rows stay even. Start
                        shows only once health is known: before that every service looks stopped. */}
                      <Group gap="xs" mih={30} wrap="nowrap">
                        {health !== undefined && !healthy && !disabled && (
                          <Button
                            size="xs"
                            color="green"
                            variant="outline"
                            leftSection={<Play size={14} />}
                            loading={isThisServicePending && pendingAction?.action === "start"}
                            disabled={isPending}
                            onClick={() => performAction({ serviceName: name, action: "start" })}
                          >
                            {t("services.start")}
                          </Button>
                        )}
                        {healthy && (
                          <Button
                            size="xs"
                            color="red"
                            variant="outline"
                            leftSection={<Stop size={14} />}
                            loading={isThisServicePending && pendingAction?.action === "stop"}
                            disabled={isPending}
                            onClick={() => askToStop(name)}
                          >
                            {t("services.stop")}
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            {listFailure && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <ErrorState failure={listFailure} compact />
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <ConfirmModal
        opened={stopOpened}
        onClose={stopDialog.close}
        onConfirm={() =>
          performAction({ serviceName: serviceToStop, action: "stop" }, { onSuccess: () => stopDialog.close() })
        }
        loading={isPending}
        title={t("confirmdialog.stopservice.title", { name: serviceLabel(serviceToStop, t) })}
        message={t("confirmdialog.stopservice.message")}
        confirmLabel={t("confirmdialog.stopservice.confirm")}
      />
    </Card>
  );
}
