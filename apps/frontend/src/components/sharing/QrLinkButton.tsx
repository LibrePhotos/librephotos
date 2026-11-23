import { ActionIcon, Button, Popover, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDownload as DownloadIcon, IconQrcode as QrcodeIcon } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { QrCode } from "./QrCode";
import { qrSquares, qrSvgDataUrl } from "./qrMatrix";

const QR_SIZE = 176;
const QR_FILE_NAME = "qr-code.svg";

type Props = Readonly<{
  url: string;
  reason?: string | false;
  warning?: string | null;
  variant?: "light" | "subtle";
}>;

const LOOKS = {
  light: { variant: "light", size: "lg" },
  subtle: { variant: "subtle", color: "gray" },
} as const;

export function QrLinkButton({ url, reason, warning, variant = "subtle" }: Props) {
  const { t } = useTranslation();
  const [opened, { open, close, toggle }] = useDisclosure(false);
  const label = t("sharing.showQrCode");
  const icon = <QrcodeIcon size={18} />;

  if (reason) {
    return (
      <DisabledReason label={label} reason={reason}>
        <ActionIcon {...LOOKS[variant]} aria-label={label}>
          {icon}
        </ActionIcon>
      </DisabledReason>
    );
  }

  return (
    <Popover
      opened={opened}
      onChange={isOpen => (isOpen ? open() : close())}
      withRoles={false}
      withArrow
      trapFocus
      returnFocus
      position="bottom-end"
      shadow="md"
    >
      <Popover.Target>
        <Tooltip label={label} withArrow disabled={opened}>
          <ActionIcon
            {...LOOKS[variant]}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={opened}
            onClick={toggle}
          >
            {icon}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown role="dialog" aria-label={t("sharing.qrCode")}>
        <QrCodePanel url={url} warning={warning} />
      </Popover.Dropdown>
    </Popover>
  );
}

function QrCodePanel({ url, warning }: Readonly<{ url: string; warning?: string | null }>) {
  const { t } = useTranslation();
  const squares = useMemo(() => qrSquares(url), [url]);
  return (
    <Stack gap="xs" align="center" maw={QR_SIZE}>
      <QrCode squares={squares} label={t("sharing.qrCode")} size={QR_SIZE} />
      {warning && (
        <Text size="xs" c="orange" ta="center">
          {warning}
        </Text>
      )}
      <Text size="xs" c="dimmed" ta="center">
        {t("sharing.qrCodeHint")}
      </Text>
      <Button
        component="a"
        href={qrSvgDataUrl(squares)}
        download={QR_FILE_NAME}
        size="xs"
        variant="light"
        leftSection={<DownloadIcon size={14} />}
        data-mantine-stop-propagation
      >
        {t("sharing.downloadQrCode")}
      </Button>
    </Stack>
  );
}
