import type { PhotoShareLink } from "@librephotos/api-client";
import { ActionIcon, Button, CopyButton, Group, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import {
  IconCheck as CheckIcon,
  IconCopy as CopyIcon,
  IconClockEdit as ExpiryIcon,
  IconLink as LinkIcon,
  IconRefresh as RefreshIcon,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoSharesQuery, usePhotoShareMutation } from "../../api_client/photos/hooks";
import { shareAddress } from "../../api_client/urls";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { Panel } from "../common/surfaces/Panel";
import { ConfirmPopover } from "./ConfirmPopover";
import { isLinkExpired, linkExpiryCaption } from "./linkExpiry";
import { PhotoShareLinkModal } from "./PhotoShareLinkModal";
import { QrLinkButton } from "./QrLinkButton";

const THUMBNAIL_SIZE = 36;
const LINK_MIN_WIDTH = 200;

/** One link, with its own mutation so only this row shows a spinner. */
function PhotoShareRow({ share, onEditExpiry }: Readonly<{ share: PhotoShareLink; onEditExpiry: () => void }>) {
  const { t } = useTranslation();
  const { mutate, isPending, variables } = usePhotoShareMutation();
  const photoId = share.photo_id;
  const fullUrl = `${shareAddress}${share.url}`;
  const expiry = linkExpiryCaption(t, share.expires_at);
  const expired = isLinkExpired(share.expires_at);

  return (
    <Group gap="xs" align="flex-start" style={{ rowGap: 4 }}>
      {share.image_hash && <MediaThumbnail imageHash={share.image_hash} size={THUMBNAIL_SIZE} />}
      <Stack gap={4} style={{ flex: `1 1 ${LINK_MIN_WIDTH}px`, minWidth: 0 }}>
        <TextInput
          readOnly
          value={fullUrl}
          onFocus={e => e.currentTarget.select()}
          aria-label={t("sharing.photoLink")}
        />
        {expiry && (
          <Text size="xs" c={expired ? "orange" : "dimmed"}>
            {expiry}
          </Text>
        )}
      </Stack>
      <Group gap={4} wrap="nowrap" h={THUMBNAIL_SIZE} ml="auto" style={{ flexShrink: 0 }}>
        <CopyButton value={fullUrl}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "green" : "gray"}
                onClick={copy}
                aria-label={t("sharing.copyLink")}
              >
                {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        <QrLinkButton url={fullUrl} warning={expired ? t("sharing.qrCodeExpired") : null} />
        <Tooltip label={t("sharing.changeExpiry")} withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onEditExpiry} aria-label={t("sharing.changeExpiry")}>
            <ExpiryIcon size={18} />
          </ActionIcon>
        </Tooltip>
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
  const [expiryPhotoId, setExpiryPhotoId] = useState<string | null>(null);

  if (isLoading || !shares || shares.length === 0) {
    return null;
  }

  return (
    <Panel p="md">
      <Stack gap="sm">
        <Group gap="xs">
          <LinkIcon size={18} />
          <Title order={5}>{t("sharing.photoLinks")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("sharing.photoLinksExplanation")}
        </Text>
        <Stack gap="md">
          {shares.map(share => (
            <PhotoShareRow key={share.photo_id} share={share} onEditExpiry={() => setExpiryPhotoId(share.photo_id)} />
          ))}
        </Stack>
      </Stack>
      <PhotoShareLinkModal photoId={expiryPhotoId} onClose={() => setExpiryPhotoId(null)} />
    </Panel>
  );
}
