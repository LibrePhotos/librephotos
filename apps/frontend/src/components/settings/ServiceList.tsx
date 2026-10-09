import { ActionIcon, Badge, Button, Card, Group, Loader, Table, Title, Tooltip } from "@mantine/core";
import { IconPlayerPlay as Play, IconRefresh as Refresh, IconPlayerStop as Stop } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "../../api_client/api";
import { useServiceActionMutation } from "../../api_client/services/hooks/useServiceActionMutation";
import {
  ServiceHealthQueryKeys,
  useServicesHealthQuery,
  useServicesListQuery,
} from "../../api_client/services/hooks/useServicesQuery";

// English names; t("services.label_<name>") translates them, and a service the frontend does not
// know yet shows its raw name.
const SERVICE_LABELS: Record<string, string> = {
  image_similarity: "Image Similarity",
  thumbnail: "Thumbnail",
  face_recognition: "Face Recognition",
  clip_embeddings: "CLIP Embeddings",
  llm: "LLM",
  image_captioning: "Image Captioning",
  exif: "EXIF",
  tags: "Tags",
  ocr: "OCR",
};

export function ServiceList() {
  const { t } = useTranslation();
  const { data: servicesList, isLoading: isLoadingList } = useServicesListQuery();

  const serviceNames = servicesList ? Object.keys(servicesList.services) : [];
  const { data: healthMap, isLoading: isLoadingHealth } = useServicesHealthQuery(serviceNames, {
    enabled: serviceNames.length > 0,
  });

  const { mutate: performAction, isPending, variables: pendingAction } = useServiceActionMutation();

  const isLoading = isLoadingList || isLoadingHealth;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: [...ServiceHealthQueryKeys] });
  };

  return (
    <Card shadow="md">
      <Group justify="space-between" mb={16}>
        <Group gap="xs">
          <Title order={4}>{t("services.header")}</Title>
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
                    <Table.Td>{t(`services.label_${name}`, SERVICE_LABELS[name] ?? name)}</Table.Td>
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
                            onClick={() => performAction({ serviceName: name, action: "stop" })}
                          >
                            {t("services.stop")}
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
