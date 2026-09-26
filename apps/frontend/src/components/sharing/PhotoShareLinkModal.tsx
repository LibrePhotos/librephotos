import { ActionIcon, Button, CopyButton, Group, Loader, Modal, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck as CheckIcon, IconCopy as CopyIcon, IconRefresh as RefreshIcon } from "@tabler/icons-react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { shareAddress } from "../../api_client/apiClient";
import { usePhotoShareMutation } from "../../api_client/photos/hooks";

type Props = {
  /** The photo to share; the dialog is open while this is set. */
  photoId: string | null;
  onClose: () => void;
};

/** Create (or show) a photo's share link, with copy, replace and revoke.
 *
 * The link is shown rather than copied straight away: a clipboard write made
 * after an awaited request has lost the user's click, and Safari refuses it.
 * The copy button below writes during its own click, so it works everywhere.
 */
export function PhotoShareLinkModal({ photoId, onClose }: Readonly<Props>) {
  const { t } = useTranslation();
  const { mutate, reset, data: share, isPending, isError } = usePhotoShareMutation();

  useEffect(() => {
    if (photoId) {
      mutate({ photoId, action: "enable" });
    } else {
      reset();
    }
  }, [photoId, mutate, reset]);

  const fullUrl = share?.url ? `${shareAddress}${share.url}` : "";

  return (
    <Modal opened={!!photoId} onClose={onClose} title={t("sharing.photoLink")} centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("sharing.photoLinkExplanation")}
        </Text>
        {isPending && (
          <Group justify="center">
            <Loader size="sm" />
          </Group>
        )}
        {!isPending && isError && (
          <Text size="sm" c="red">
            {t("sharing.photoLinkFailed")}
          </Text>
        )}
        {!isPending && fullUrl && (
          <>
            <Group gap="xs" wrap="nowrap">
              <TextInput readOnly value={fullUrl} style={{ flexGrow: 1 }} onFocus={e => e.currentTarget.select()} />
              <CopyButton value={fullUrl}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} withArrow>
                    <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy}>
                      {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end" gap="xs">
              <Button
                variant="subtle"
                leftSection={<RefreshIcon size={16} />}
                onClick={() => photoId && mutate({ photoId, action: "rotate" })}
              >
                {t("sharing.rotateLink")}
              </Button>
              <Button
                variant="subtle"
                color="red"
                onClick={() => photoId && mutate({ photoId, action: "disable" }, { onSuccess: onClose })}
              >
                {t("sharing.revokeLink")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
