import { photoLicenseUrl, type PhotoLicenseId, type PhotoMetadata } from "@librephotos/api-client";
import { ActionIcon, Anchor, Button, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { IconCopyright, IconExternalLink, IconPencil } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchPhotoMetadataQuery,
  useSetPhotosRightsMutation,
  useUpdatePhotoMetadataMutation,
} from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { LicenseBadge } from "./LicenseBadge";
import { asLicense, LICENSES } from "./photoLicenses";
import { FromFileBadge, RightsForm } from "./RightsForm";
import type { RightsFormValues } from "./RightsForm.schema";
import classes from "./RightsSection.module.css";

type Props = Readonly<{
  photo: Readonly<{ id: string; image_hash: string }>;
  /**
   * Shown instead of the section's own icon and title, next to its edit controls: the photo page's
   * cards bring their own heading.
   */
  heading?: React.ReactNode;
}>;

/** The rights as the editor holds them: empty text for none. */
function savedRights(metadata: PhotoMetadata | undefined): RightsFormValues {
  return {
    copyright: metadata?.copyright ?? "",
    creator: metadata?.creator ?? "",
    license: asLicense(metadata?.license),
  };
}

/** The license, its full name as a link to its deed (never a URL from the file), and whether it is the file's. */
function LicenseLine({ license, fromFile }: Readonly<{ license: PhotoLicenseId; fromFile: boolean }>) {
  const { t } = useTranslation();
  const url = photoLicenseUrl(license);
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <LicenseBadge license={license} />
        {fromFile && <FromFileBadge />}
      </Group>
      {url && (
        <Anchor href={url} target="_blank" rel="noopener noreferrer" size="xs">
          <Group gap={4} component="span" wrap="nowrap">
            {t("rights.deedLink", { license: t(LICENSES[license].title) })}
            <IconExternalLink size={12} aria-hidden />
          </Group>
        </Anchor>
      )}
    </Stack>
  );
}

function TextLine({ label, value, fromFile }: Readonly<{ label: string; value: string; fromFile: boolean }>) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" miw={72}>
        {label}
      </Text>
      <Text size="sm" className={classes.value}>
        {value}
      </Text>
      {fromFile && <FromFileBadge />}
    </Group>
  );
}

/** No rights yet: say what that means for public pages, and offer the owner's default. */
function NoRights({ photoHash }: Readonly<{ photoHash: string }>) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate, isPending } = useSetPhotosRightsMutation();
  const license = asLicense(user?.default_license);
  const defaults = {
    ...(license ? { license } : {}),
    ...(user?.default_creator ? { creator: user.default_creator } : {}),
    ...(user?.default_copyright ? { copyright: user.default_copyright } : {}),
  };
  const hasDefault = Object.keys(defaults).length > 0;
  return (
    <Stack gap="xs" align="flex-start">
      <Text size="sm" c="dimmed">
        {t("rights.none")}
      </Text>
      {hasDefault && (
        <Button
          size="xs"
          variant="light"
          loading={isPending}
          onClick={() => mutate({ selection: { image_hashes: [photoHash] }, rights: defaults, keep: "any" })}
        >
          {license ? t("rights.useDefaultLicense", { license: t(LICENSES[license].name) }) : t("rights.useDefault")}
        </Button>
      )}
    </Stack>
  );
}

function RightsView({ metadata, photoHash }: Readonly<{ metadata: PhotoMetadata; photoHash: string }>) {
  const { t } = useTranslation();
  const { copyright, creator, license } = savedRights(metadata);
  const fromFile = metadata.rights_from_file ?? [];
  if (!copyright && !creator && !license) return <NoRights photoHash={photoHash} />;
  return (
    <Stack gap="xs">
      {license && <LicenseLine license={license} fromFile={fromFile.includes("license")} />}
      {copyright && (
        <TextLine label={t("rights.copyright")} value={copyright} fromFile={fromFile.includes("copyright")} />
      )}
      {creator && <TextLine label={t("rights.creator")} value={creator} fromFile={fromFile.includes("creator")} />}
    </Stack>
  );
}

/**
 * The owner's Rights section (#425): the photo's copyright notice, creator and license, read from
 * its file or set here. Public pages show them to visitors.
 */
export function RightsSection({ photo, heading }: Props) {
  // The draft belongs to one photo: remount when the photo changes.
  return <RightsEditor key={photo.image_hash} photo={photo} heading={heading} />;
}

function RightsEditor({ photo, heading }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const { data: metadata } = useFetchPhotoMetadataQuery(photo.id);
  const { mutate, isPending } = useUpdatePhotoMetadataMutation();
  const title = heading ?? (
    <Group gap="xs" wrap="nowrap">
      <IconCopyright aria-hidden />
      <Title order={4}>{t("rights.title")}</Title>
    </Group>
  );

  if (!metadata) return null;
  if (editing) {
    return (
      <RightsForm
        saved={savedRights(metadata)}
        fromFile={metadata.rights_from_file ?? []}
        saving={isPending}
        heading={title}
        onCancel={() => setEditing(false)}
        onSave={updates => mutate({ photoId: photo.id, updates }, { onSuccess: () => setEditing(false) })}
      />
    );
  }
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        {title}
        <Tooltip label={t("rights.edit")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("rights.edit")}
            onClick={() => setEditing(true)}
          >
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <RightsView metadata={metadata} photoHash={photo.image_hash} />
    </Stack>
  );
}
