import { ActionIcon, Popover, Stack, Text } from "@mantine/core";
import { IconQrcode as QrcodeIcon } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { QrCode } from "./QrCode";

type Props = Readonly<{
  url: string;
  size?: "sm" | "lg";
}>;

export function QrLinkButton({ url, size = "lg" }: Props) {
  const { t } = useTranslation();
  return (
    <Popover position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon variant="light" size={size} aria-label={t("sharing.qrCode")}>
          <QrcodeIcon size={18} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={4} align="center">
          <QrCode value={url} />
          <Text size="xs" c="dimmed">
            {t("sharing.qrCodeHint")}
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
