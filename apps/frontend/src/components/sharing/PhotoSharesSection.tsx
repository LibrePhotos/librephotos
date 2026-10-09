import { ActionIcon, Button, CopyButton, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import {
  IconCheck as CheckIcon,
  IconCopy as CopyIcon,
  IconLink as LinkIcon,
  IconRefresh as RefreshIcon,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { shareAddress } from "../../api_client/apiClient";
import { useFetchPhotoSharesQuery, usePhotoShareMutation } from "../../api_client/photos/hooks";
import type { PhotoShare } from "../../api_client/photos/hooks";
import { ConfirmPopover } from "./ConfirmPopover";
import { ShareThumbnail } from "./ShareThumbnail";

/** One link, with its own mutation so only this row shows a spinner. */
function PhotoShareRow({ share }: Readonly<{ share: PhotoShare }>) {
  const { t } = useTranslation();
  const { mutate, isPending, variables } = usePhotoShareMutation();
  const photoId = share.photo_id ?? "";
  const fullUrl = `${shareAddress}${share.url}`;

  return (
    <Group gap="xs" wrap="nowrap">
      {share.image_hash && <ShareThumbnail imageHash={share.image_hash} size={36} />}
      {/* The link gives way on a phone; the buttons keep their size (Revoke was cut off). */}
      <TextInput
        readOnly
        value={fullUrl}
        style={{ flex: 1, minWidth: 0 }}
        onFocus={e => e.currentTarget.select()}
        aria-label={t("sharing.photoLink")}
      />
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <CopyButton value={fullUrl}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "teal" : "gray"}
                onClick={copy}
                aria-label={t("sharing.copyLink")}
              >
                {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        {/* Icon-only, right next to Copy: a misclick used to end the link at once. */}
        <ConfirmPopover
          message={t("sharing.rotateLinkConfirm")}
          confirmLabel={t("sharing.rotateLink")}
          tooltip={t("sharing.rotateLink")}
          onConfirm={() => mutate({ photoId, action: "rotate" })}
        >
          <ActionIcon
            variant="subtle"
            aria-label={t("sharing.rotateLink")}
            loading={isPending && variables?.action === "rotate"}
            disabled={isPending}
          >
            <RefreshIcon size={18} />
          </ActionIcon>
        </ConfirmPopover>
        <ConfirmPopover
          message={t("sharing.revokeLinkConfirm")}
          confirmLabel={t("sharing.revokeLink")}
          color="red"
          onConfirm={() => mutate({ photoId, action: "disable" })}
        >
          <Button
            size="xs"
            variant="subtle"
            color="red"
            loading={isPending && variables?.action === "disable"}
            disabled={isPending}
          >
            {t("sharing.revokeLink")}
          </Button>
        </ConfirmPopover>
      </Group>
    </Group>
  );
}

/** Active per-photo share links, with rotate and revoke (issue #2028).
 *
 * Mirrors AlbumSlugSection, the album equivalent: a link is a random slug the
 * owner can replace or withdraw, not a URL derived from the photo itself.
 */
export function PhotoSharesSection() {
  const { t } = useTranslation();
  const { data: shares, isLoading } = useFetchPhotoSharesQuery();

  if (isLoading || !shares || shares.length === 0) {
    return null;
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <LinkIcon size={18} />
          <Title order={5}>{t("sharing.photoLinks")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("sharing.photoLinksExplanation")}
        </Text>
        {shares.map(share => (
          <PhotoShareRow key={share.photo_id ?? share.slug} share={share} />
        ))}
      </Stack>
    </Paper>
  );
}
