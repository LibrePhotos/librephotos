import type { UserAlbum } from "@librephotos/api-client";
import { Stack, Switch, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetAlbumMemberCeilingMutation } from "../../api_client/albums/hooks";
import { ceilingAllows, MEMBER_FIELDS } from "./memberFields";

type Props = Readonly<{ albumID: string; album: UserAlbum | undefined }>;

/**
 * The owner's "What members see" switches (#464): the album's ceiling. A detail of a photo shows to
 * members only where this allows it and the photo's owner allows it too ("both must allow").
 */
export function MemberCeilingSection({ albumID, album }: Props) {
  const { t } = useTranslation();
  const setCeiling = useSetAlbumMemberCeilingMutation();
  return (
    <Stack gap="xs">
      <div>
        <Title order={5}>{t("collab.membersSee")}</Title>
        <Text size="xs" c="dimmed">
          {t("collab.membersSeeDesc")}
        </Text>
      </div>
      {MEMBER_FIELDS.map(field => (
        <Switch
          key={field.ceiling}
          size="sm"
          label={t(field.label)}
          checked={ceilingAllows(album, field)}
          onChange={event =>
            setCeiling.mutate({ albumId: albumID, ceiling: { [field.ceiling]: event.currentTarget.checked } })
          }
        />
      ))}
    </Stack>
  );
}
