import { Badge, Button, Card, Group, Loader, Table, Title, Tooltip } from "@mantine/core";
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

const SERVICE_LABELS: Record<string, string> = {
  image_similarity: "Image Similarity",
  thumbnail: "Thumbnail",
  face_recognition: "Face Recognition",
  clip_embeddings: "CLIP Embeddings",
  llm: "LLM",
  image_captioning: "Image Captioning",
  exif: "EXIF",
  tags: "Tags",
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
        <Tooltip label={t("services.refresh")}>
          <Button variant="subtle" size="xs" onClick={handleRefresh} loading={isLoadingHealth}>
            <Refresh size={16} />
          </Button>
        </Tooltip>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("services.name")}</Table.Th>
            <Table.Th>{t("services.port")}</Table.Th>
            <Table.Th>{t("services.status")}</Table.Th>
            <Table.Th>{t("services.actions")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {servicesList &&
            Object.entries(servicesList.services).map(([name, port]) => {
              const healthy = healthMap?.[name];
              const isThisServicePending = isPending && pendingAction?.serviceName === name;

              return (
                <Table.Tr key={name}>
                  <Table.Td>{SERVICE_LABELS[name] ?? name}</Table.Td>
                  <Table.Td>{port}</Table.Td>
                  <Table.Td>
                    {healthMap === undefined ? (
                      <Loader size="xs" />
                    ) : (
                      <Badge color={healthy ? "green" : "red"} variant="filled">
                        {healthy ? t("services.healthy") : t("services.unhealthy")}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
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
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
