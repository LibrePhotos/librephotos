import {
  ActionIcon,
  Button,
  CopyButton,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck as CheckIcon,
  IconCopy as CopyIcon,
  IconLink as LinkIcon,
  IconRefresh as RefreshIcon,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress, shareAddress } from "../../api_client/apiClient";
import { useFetchPhotoSharesQuery, usePhotoShareMutation } from "../../api_client/photos/hooks";
import type { PhotoShare } from "../../api_client/photos/hooks";

/** One link, with its own mutation so only this row shows a spinner. */
function PhotoShareRow({ share }: Readonly<{ share: PhotoShare }>) {
  const { t } = useTranslation();
  const { mutate, isPending, variables } = usePhotoShareMutation();
  const photoId = share.photo_id ?? "";
  const fullUrl = `${shareAddress}${share.url}`;

  return (
    <Group gap="xs" wrap="nowrap">
      {share.image_hash && (
        <Image
          src={`${serverAddress}/media/square_thumbnails_small/${share.image_hash}`}
          w={36}
          h={36}
          radius="sm"
          alt=""
        />
      )}
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
      <Tooltip label={t("sharing.rotateLink")} withArrow>
        <ActionIcon
          variant="subtle"
          loading={isPending && variables?.action === "rotate"}
          disabled={isPending}
          onClick={() => mutate({ photoId, action: "rotate" })}
        >
          <RefreshIcon size={18} />
        </ActionIcon>
      </Tooltip>
      <Button
        size="xs"
        variant="subtle"
        color="red"
        loading={isPending && variables?.action === "disable"}
        disabled={isPending}
        onClick={() => mutate({ photoId, action: "disable" })}
      >
        {t("sharing.revokeLink")}
      </Button>
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
