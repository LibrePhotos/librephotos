import { ActionIcon, Button, Checkbox, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { IconCopy as CopyIcon, IconLink as LinkIcon } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToggleUserAlbumPublicMutation, type PublicSharingOptions } from "../../api_client/albums/hooks";
import { UserAlbum } from "../../api_client/albums/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { type PublicSharingDefaults, type User } from "../../api_client/user/types";
import { copyToClipboard } from "../../util/util";

dayjs.extend(customParseFormat);

type SlugMeta = { valid: boolean; available: boolean; checking: boolean };
type SlugProps = Readonly<{
  value: string;
  onChange: (v: string) => void;
  isPublic: boolean;
  albumId?: string; // album id as string for comparison with API
  onMetaChange: (m: SlugMeta) => void;
}>;

function SlugSetting({ value, onChange, isPublic, albumId, onMetaChange }: SlugProps) {
  const { t } = useTranslation();
  const slugRegex = useMemo(() => /^[a-z0-9-]{3,64}$/i, []);
  const valid = slugRegex.test(value.trim());

  const enabled = isPublic && value.trim().length > 0 && valid;
  const { data: existingId, isFetching } = useQuery({
    queryKey: ["slugAvailable", value],
    enabled,
    queryFn: async () => {
      const resp = await fetch(`/api/public/albums/s/${encodeURIComponent(value)}/`);
      if (resp.ok) {
        const data = await resp.json();
        return data?.results?.id ?? "__exists__";
      }
      if (resp.status === 404) return null;
      return null;
    },
    staleTime: 30_000,
    retry: false,
  });

  const available = !enabled || existingId === null || String(existingId) === String(albumId ?? "");

  useEffect(() => {
    onMetaChange({ valid, available, checking: isFetching });
  }, [valid, available, isFetching, onMetaChange]);

  function getErrorMessage(): string | undefined {
    if (!valid) return t("sharing.customUrlError");
    if (!available) return t("sharing.urlTaken");
    return undefined;
  }

  return (
    <TextInput
      label={t("sharing.customUrl")}
      placeholder={t("sharing.customUrlPlaceholder")}
      value={value}
      onChange={e => onChange(e.currentTarget.value)}
      error={getErrorMessage()}
      rightSection={isFetching ? <span style={{ fontSize: 12 }}>…</span> : undefined}
    />
  );
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
        value={value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : ""}
        onChange={v => {
          if (!v) {
            onChange("");
            return;
          }
          const parsed = dayjs(v, "YYYY-MM-DD HH:mm:ss");
          onChange(parsed.isValid() ? parsed.toDate().toISOString() : "");
        }}
        presets={[
          { value: dayjs().add(7, "day").format("YYYY-MM-DD HH:mm:ss"), label: t("sharing.days7") },
          { value: dayjs().add(30, "day").format("YYYY-MM-DD HH:mm:ss"), label: t("sharing.days30") },
          { value: dayjs().add(90, "day").format("YYYY-MM-DD HH:mm:ss"), label: t("sharing.days90") },
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

export function AlbumSlugSection({ albumID, album, isPublic, showSettings, refetch }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [customSlug, setCustomSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [expiresDirty, setExpiresDirty] = useState(false);
  const [sharingOptionsDirty, setSharingOptionsDirty] = useState(false);
  const [sharingOptions, setSharingOptions] = useState<PublicSharingOptions>({});
  const [slugValid, setSlugValid] = useState(true);
  const [slugAvailable, setSlugAvailable] = useState(true);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const toggleAlbumPublic = useToggleUserAlbumPublicMutation();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery() as { data: User | undefined };

  // derived values
  const slugLink = album?.public_slug ? `${window.location.origin}/public/s/${album.public_slug}` : "";
  const effectiveSlug = slugDirty ? customSlug : album?.public_slug || "";
  const effectiveExpires = expiresDirty ? expiresAt : (album?.public_expires_at as unknown as string) || "";

  // initialize from album when it changes (unless user started editing)
  useEffect(() => {
    if (!album) return;
    if (!slugDirty) setCustomSlug(album.public_slug || "");
    if (!expiresDirty) setExpiresAt((album.public_expires_at as unknown as string) || "");
    if (!sharingOptionsDirty && album.public_sharing_options) {
      setSharingOptions(album.public_sharing_options);
    }
  }, [album?.public_slug, album?.public_expires_at, album?.public_sharing_options]);

  // validation handled in SlugSetting; availability via query in that component updates parent through setters

  const hasChanges = useMemo(() => {
    const slugChanged = slugDirty && effectiveSlug.trim() !== (album?.public_slug || "");
    const expChanged =
      expiresDirty && (effectiveExpires || "") !== ((album?.public_expires_at as unknown as string) || "");
    return slugChanged || expChanged || sharingOptionsDirty;
  }, [
    slugDirty,
    effectiveSlug,
    expiresDirty,
    effectiveExpires,
    sharingOptionsDirty,
    album?.public_slug,
    album?.public_expires_at,
  ]);

  const canSave = useMemo(
    () => isPublic && hasChanges && slugValid && slugAvailable && !isCheckingSlug,
    [isPublic, hasChanges, slugValid, slugAvailable, isCheckingSlug]
  );

  const onSave = useCallback(() => {
    setErrorMsg("");
    toggleAlbumPublic.mutate(
      {
        albumId: albumID,
        public: true,
        slug: slugDirty ? effectiveSlug.trim() : undefined,
        expires_at: expiresDirty ? effectiveExpires || null : undefined,
        sharing_options: sharingOptionsDirty ? sharingOptions : undefined,
      },
      {
        onSuccess: () => {
          refetch();
          setSlugDirty(false);
          setExpiresDirty(false);
          setSharingOptionsDirty(false);
        },
        onError: () => setErrorMsg(t("sharing.saveLinkError")),
      }
    );
  }, [
    albumID,
    effectiveSlug,
    effectiveExpires,
    slugDirty,
    expiresDirty,
    sharingOptionsDirty,
    sharingOptions,
    toggleAlbumPublic,
    refetch,
  ]);

  const openLink = useCallback(() => {
    if (slugLink) window.open(slugLink, "_blank", "noopener,noreferrer");
  }, [slugLink]);

  return (
    <>
      <Group mt="sm" align="flex-end">
        <TextInput
          style={{ flexGrow: 1 }}
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

      {showSettings && (
        <Stack mt="xs" gap="xs">
          <SlugSetting
            value={slugDirty ? customSlug : effectiveSlug}
            onChange={v => {
              setCustomSlug(v.toLowerCase());
              setSlugDirty(true);
            }}
            isPublic={isPublic}
            albumId={album?.id}
            onMetaChange={meta => {
              setSlugValid(meta.valid);
              setSlugAvailable(meta.available);
              setIsCheckingSlug(meta.checking);
            }}
          />
          <ExpiresSetting
            value={expiresDirty ? expiresAt : effectiveExpires}
            onChange={v => {
              setExpiresAt(v);
              setExpiresDirty(true);
            }}
          />
          <SharingOptionsSettings
            value={sharingOptions}
            onChange={v => {
              setSharingOptions(v);
              setSharingOptionsDirty(true);
            }}
            userDefaults={currentUser?.public_sharing_defaults}
          />
          <Group>
            <Button variant="default" disabled={!canSave} onClick={onSave}>
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
