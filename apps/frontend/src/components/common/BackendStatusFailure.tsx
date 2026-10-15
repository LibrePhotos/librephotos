import { Accordion, Button, Code, Group, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { BackendStatus } from "../../api_client/server";
import { failureDocs, supportDetails, type FailedScreen } from "./backendStatusCopy";

const COPIED_MS = 2000;

type BackendStatusFailureProps = Readonly<{
  status: Extract<BackendStatus, { kind: "down" }>;
  screen: FailedScreen;
}>;

/** `navigator.clipboard` exists only on HTTPS and localhost; on plain HTTP the details are shown to select. */
const canCopy = () => window.isSecureContext && typeof navigator.clipboard?.writeText === "function";

/**
 * What a failed update offers: the upgrade guide's section for it, Copy details for a support
 * question, and the reason code for whoever runs the server.
 */
export function BackendStatusFailure({ status, screen }: BackendStatusFailureProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: COPIED_MS });
  const details = () =>
    supportDetails({
      readiness: status.readiness,
      version: status.version,
      address: window.location.origin,
      time: new Date().toISOString(),
    });

  return (
    <Stack gap="md" w="100%" align="center">
      <Group gap="sm" justify="center">
        <Button
          component="a"
          href={failureDocs(screen)}
          target="_blank"
          rel="noreferrer"
          rightSection={<IconExternalLink size={16} />}
        >
          {t("backendStatus.upgradeGuide")}
        </Button>
        {canCopy() && (
          <Button
            variant="default"
            leftSection={clipboard.copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            onClick={() => clipboard.copy(details())}
          >
            {t(clipboard.copied ? "backendStatus.copied" : "backendStatus.copyDetails")}
          </Button>
        )}
      </Group>
      <Accordion variant="contained" w="100%">
        <Accordion.Item value="details">
          <Accordion.Control>{t("backendStatus.detailsTitle")}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="sm">{t(`backendStatus.${screen}.details`)}</Text>
              <Code block>{details()}</Code>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
