import type { PublicSharingOptions, UserAlbum } from "@librephotos/api-client";
import { type PublicSharingDefaults } from "@librephotos/api-client";
import { ActionIcon, Button, Checkbox, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { schemaResolver, useForm } from "@mantine/form";
import { IconCopy as CopyIcon, IconLink as LinkIcon } from "@tabler/icons-react";
import React, { useCallback, useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSlugAvailabilityQuery, useToggleUserAlbumPublicMutation } from "../../api_client/albums/hooks";
import { ApiError } from "../../api_client/api";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { fromPickerValue, pickerValueDaysFromNow, toPickerValue } from "../../util/dateUtils";
import { copyToClipboard } from "../../util/util";
import { makeAlbumLinkSchema } from "./AlbumSlugSection.schema";
import { publicAlbumLink } from "./publicAlbum";

/**
 * Whether another album already holds `slug`, asked of the public endpoint while `enabled` (the
 * link is public and the slug has the right shape).
 */
function useSlugTaken(slug: string, enabled: boolean, albumId: number | undefined) {
  const { data: existingId, isFetching } = useSlugAvailabilityQuery(slug, enabled);

  // No answer yet (undefined) is not "taken": saving waits for the check through `checking`.
  const taken = enabled && existingId !== undefined && existingId !== null && existingId !== albumId;
  return { taken, checking: isFetching };
}

type ExpiresProps = Readonly<{
  value: string;
  onChange: (v: string) => void;
}>;

function ExpiresSetting({ value, onChange }: ExpiresProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <DateTimePicker
        label={t("sharing.expiration")}
        placeholder={t("sharing.pickExpiration")}
        withSeconds
        clearable
        value={toPickerValue(value)}
        onChange={v => {
          if (!v) {
            onChange("");
            return;
          }
          onChange(fromPickerValue(v) ?? "");
        }}
        presets={[
          { value: pickerValueDaysFromNow(7), label: t("sharing.days7") },
          { value: pickerValueDaysFromNow(30), label: t("sharing.days30") },
          { value: pickerValueDaysFromNow(90), label: t("sharing.days90") },
        ]}
      />
      <Group gap="xs">
        <Button size="xs" variant="subtle" onClick={() => onChange("")}>
          {t("sharing.never")}
        </Button>
      </Group>
    </Stack>
  );
}

// Sharing options component for controlling what metadata is shown in public albums
type SharingOptionsProps = Readonly<{
  value: PublicSharingOptions;
  onChange: (v: PublicSharingOptions) => void;
  userDefaults?: PublicSharingDefaults;
}>;

function SharingOptionsSettings({ value, onChange, userDefaults }: SharingOptionsProps) {
  const { t } = useTranslation();

  // Get effective value (album override or user default) - always returns boolean
  const getEffectiveValue = (key: keyof PublicSharingOptions): boolean => {
    const albumValue = value[key];
    if (typeof albumValue === "boolean") {
      return albumValue;
    }
    // Fall back to user defaults, then to false
    return userDefaults?.[key] ?? false;
  };

  // Simple two-state toggle: just flip the boolean value
  // If currently using default (null), set to opposite of effective value
  const handleChange = (key: keyof PublicSharingOptions) => {
    const effectiveValue = getEffectiveValue(key);
    onChange({ ...value, [key]: !effectiveValue });
  };

  type OptionConfig = {
    key: keyof PublicSharingOptions;
    label: string;
    description: string;
  };

  const options: OptionConfig[] = [
    { key: "share_timestamps", label: t("sharing.shareTimestamps"), description: t("sharing.shareTimestampsDesc") },
    { key: "share_location", label: t("sharing.shareLocation"), description: t("sharing.shareLocationDesc") },
    { key: "share_camera_info", label: t("sharing.shareCameraInfo"), description: t("sharing.shareCameraInfoDesc") },
    { key: "share_captions", label: t("sharing.shareCaptions"), description: t("sharing.shareCaptionsDesc") },
    { key: "share_faces", label: t("sharing.shareFaces"), description: t("sharing.shareFacesDesc") },
  ];

  return (
    <Paper withBorder p="sm" radius="md">
      <Title order={5} mb="xs">
        {t("sharing.photoDetailsTitle")}
      </Title>
      <Text size="xs" c="dimmed" mb="sm">
        {t("sharing.photoDetailsDesc")}
      </Text>
      <Stack gap="xs">
        {options.map(opt => (
          <Checkbox
            key={opt.key}
            label={opt.label}
            description={opt.description}
            checked={getEffectiveValue(opt.key)}
            onChange={() => handleChange(opt.key)}
          />
        ))}
      </Stack>
    </Paper>
  );
}

type Props = Readonly<{
  albumID: string;
  album?: UserAlbum;
  isPublic: boolean;
  showSettings: boolean;
  refetch: () => void;
}>;

type LinkValues = { slug: string; expires_at: string; sharing_options: PublicSharingOptions };

const serverValues = (album: UserAlbum | undefined): LinkValues => ({
  slug: album?.public_slug || "",
  expires_at: album?.public_expires_at || "",
  sharing_options: album?.public_sharing_options ?? {},
});

export function AlbumSlugSection({ albumID, album, isPublic, showSettings, refetch }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const toggleAlbumPublic = useToggleUserAlbumPublicMutation({ reportsErrors: true });
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  const form = useForm<LinkValues>({
    initialValues: serverValues(album),
    validate: schemaResolver(makeAlbumLinkSchema(t), { sync: true }),
    validateInputOnChange: ["slug"],
  });
  const slug = form.values.slug.trim();
  const { taken, checking } = useSlugTaken(slug, isPublic && form.isValid("slug"), album?.id);

  // The availability check answers after the slug changed, so it reports through the field's error.
  const takenMessage = t("sharing.urlTaken");
  const reportTaken = useEffectEvent((isTaken: boolean) => {
    if (isTaken) {
      form.setFieldError("slug", takenMessage);
    } else if (form.errors.slug === takenMessage) {
      form.clearFieldError("slug");
    }
  });
  // The slug is a trigger too: typing re-validates the field, which drops a "taken" that still holds.
  useEffect(() => {
    reportTaken(taken);
  }, [taken, slug]);

  // derived values
  const slugLink = album?.public_slug ? publicAlbumLink(album.public_slug) : "";

  // Follow the server's copy, but never over a setting the owner is editing: the dirty fields are
  // guards here, not triggers.
  const syncFromServer = useEffectEvent(() => {
    const server = serverValues(album);
    const editing = {
      slug: form.isDirty("slug"),
      expires_at: form.isDirty("expires_at"),
      sharing_options: form.isDirty("sharing_options"),
    };
    form.setInitialValues(server);
    if (!editing.slug) form.setFieldValue("slug", server.slug);
    if (!editing.expires_at) form.setFieldValue("expires_at", server.expires_at);
    if (!editing.sharing_options) form.setFieldValue("sharing_options", server.sharing_options);
  });
  // Sync whenever the server copy of these fields changes.
  useEffect(() => {
    syncFromServer();
  }, [album?.public_slug, album?.public_expires_at, album?.public_sharing_options]);

  const hasChanges =
    slug !== form.getInitialValues().slug.trim() || form.isDirty("expires_at") || form.isDirty("sharing_options");
  const canSave = isPublic && hasChanges && form.isValid() && !taken && !checking;

  const onSave = form.onSubmit(values => {
    setErrorMsg("");
    toggleAlbumPublic.mutate(
      {
        albumId: albumID,
        public: true,
        slug: form.isDirty("slug") ? values.slug.trim() : undefined,
        expires_at: form.isDirty("expires_at") ? values.expires_at || null : undefined,
        sharing_options: form.isDirty("sharing_options") ? values.sharing_options : undefined,
      },
      {
        onSuccess: () => {
          refetch();
          // What was saved is what a change is measured against, before the refetch lands too.
          form.resetDirty();
        },
        // The server checks the slug again on save: an expired share still
        // holds its slug although the availability check calls it free.
        onError: error => {
          if (error instanceof ApiError && error.status === 409) {
            setErrorMsg(t("sharing.urlTaken"));
          } else if (error instanceof ApiError && error.status === 400) {
            setErrorMsg(t("sharing.customUrlError"));
          } else {
            setErrorMsg(t("sharing.saveLinkError"));
          }
        },
      }
    );
  });

  const openLink = useCallback(() => {
    if (slugLink) window.open(slugLink, "_blank", "noopener,noreferrer");
  }, [slugLink]);

  return (
    <>
      {/* nowrap: on a phone the open-link button dropped onto a line of its own. */}
      <Group mt="sm" align="flex-end" gap="xs" wrap="nowrap">
        <TextInput
          style={{ flex: 1, minWidth: 0 }}
          value={slugLink || t("sharing.generating")}
          readOnly
          leftSection={<LinkIcon size={16} />}
        />
        <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} opened={copied ? true : undefined}>
          <ActionIcon
            variant="light"
            size="lg"
            aria-label={t("sharing.copyLink")}
            disabled={!slugLink}
            onClick={() => {
              if (!slugLink) return;
              copyToClipboard(slugLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            <CopyIcon size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("sharing.openPublicLink")}>
          <ActionIcon
            variant="light"
            size="lg"
            aria-label={t("sharing.openPublicLink")}
            disabled={!slugLink}
            onClick={openLink}
          >
            <LinkIcon size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Text size="xs" c="dimmed" mt={4}>
        {t("sharing.linkRotatesOnRevoke")}
      </Text>

      {showSettings && (
        <Stack mt="xs" gap="xs">
          <TextInput
            label={t("sharing.customUrl")}
            placeholder={t("sharing.customUrlPlaceholder")}
            {...form.getInputProps("slug")}
            onChange={event => form.setFieldValue("slug", event.currentTarget.value.toLowerCase())}
            rightSection={checking ? <span style={{ fontSize: 12 }}>…</span> : undefined}
          />
          <ExpiresSetting value={form.values.expires_at} onChange={value => form.setFieldValue("expires_at", value)} />
          <SharingOptionsSettings
            value={form.values.sharing_options}
            onChange={value => form.setFieldValue("sharing_options", value)}
            userDefaults={currentUser?.public_sharing_defaults}
          />
          <Group>
            <Button variant="default" disabled={!canSave} onClick={() => onSave()}>
              {t("sharing.saveLinkSettings")}
            </Button>
          </Group>
          {errorMsg && (
            <Text size="xs" c="red">
              {errorMsg}
            </Text>
          )}
        </Stack>
      )}
    </>
  );
}
