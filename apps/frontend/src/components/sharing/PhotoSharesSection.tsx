import { ActionIcon, Button, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconCopy as CopyIcon, IconLink as LinkIcon, IconRefresh as RefreshIcon } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { shareAddress } from "../../api_client/apiClient";
import { useFetchPhotoSharesQuery, usePhotoShareMutation } from "../../api_client/photos/hooks";
import { copyToClipboard } from "../../util/util";

/** Active per-photo share links, with rotate and revoke (issue #2028).
 *
 * Mirrors AlbumSlugSection, the album equivalent: a link is a random slug the
 * owner can replace or withdraw, not a URL derived from the photo itself.
 */
export function PhotoSharesSection() {
  const { t } = useTranslation();
  const { data: shares, isLoading } = useFetchPhotoSharesQuery();
  const photoShare = usePhotoShareMutation();

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
        {shares.map(share => {
          const fullUrl = `${shareAddress}${share.url}`;
          return (
            <Group key={share.slug} gap="xs" wrap="nowrap">
              <TextInput readOnly value={fullUrl} style={{ flexGrow: 1 }} />
              <Tooltip label={t("sharing.copyLink")} withArrow>
                <ActionIcon variant="subtle" onClick={() => copyToClipboard(fullUrl)}>
                  <CopyIcon size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("sharing.rotateLink")} withArrow>
                <ActionIcon
                  variant="subtle"
                  loading={photoShare.isPending}
                  onClick={() => photoShare.mutate({ photoId: share.photo_id ?? "", action: "rotate" })}
                >
                  <RefreshIcon size={18} />
                </ActionIcon>
              </Tooltip>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={photoShare.isPending}
                onClick={() => photoShare.mutate({ photoId: share.photo_id ?? "", action: "disable" })}
              >
                {t("sharing.revokeLink")}
              </Button>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}
