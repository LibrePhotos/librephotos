import { ActionIcon, Button, Group, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { IconCopy as CopyIcon, IconLink as LinkIcon } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToggleUserAlbumPublicMutation } from "../../api_client/albums/hooks";
import { UserAlbum } from "../../api_client/albums/types";
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
    if (!valid) return "Use lowercase letters, numbers and hyphens (3-64).";
    if (!available) return "This URL is already taken.";
    return undefined;
  }

  return (
    <TextInput
      label="Custom URL (optional)"
      placeholder="my-family-album"
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
  return (
    <Stack gap="xs">
      <DateTimePicker
        label="Expiration (optional)"
        placeholder="Pick expiration"
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
          { value: dayjs().add(7, "day").format("YYYY-MM-DD HH:mm:ss"), label: "7 days" },
          { value: dayjs().add(30, "day").format("YYYY-MM-DD HH:mm:ss"), label: "30 days" },
          { value: dayjs().add(90, "day").format("YYYY-MM-DD HH:mm:ss"), label: "90 days" },
        ]}
      />
      <Group gap="xs">
        <Button size="xs" variant="subtle" onClick={() => onChange("")}>
          Never
        </Button>
      </Group>
    </Stack>
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
  const [copied, setCopied] = useState(false);
  const [customSlug, setCustomSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [expiresDirty, setExpiresDirty] = useState(false);
  const [slugValid, setSlugValid] = useState(true);
  const [slugAvailable, setSlugAvailable] = useState(true);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const toggleAlbumPublic = useToggleUserAlbumPublicMutation();

  // derived values
  const slugLink = album?.public_slug ? `${window.location.origin}/public/s/${album.public_slug}` : "";
  const effectiveSlug = slugDirty ? customSlug : album?.public_slug || "";
  const effectiveExpires = expiresDirty ? expiresAt : (album?.public_expires_at as unknown as string) || "";

  // initialize from album when it changes (unless user started editing)
  useEffect(() => {
    if (!album) return;
    if (!slugDirty) setCustomSlug(album.public_slug || "");
    if (!expiresDirty) setExpiresAt((album.public_expires_at as unknown as string) || "");
  }, [album?.public_slug, album?.public_expires_at]);

  // validation handled in SlugSetting; availability via query in that component updates parent through setters

  const hasChanges = useMemo(() => {
    const slugChanged = slugDirty && effectiveSlug.trim() !== (album?.public_slug || "");
    const expChanged =
      expiresDirty && (effectiveExpires || "") !== ((album?.public_expires_at as unknown as string) || "");
    return slugChanged || expChanged;
  }, [slugDirty, effectiveSlug, expiresDirty, effectiveExpires, album?.public_slug, album?.public_expires_at]);

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
      },
      {
        onSuccess: () => {
          refetch();
          setSlugDirty(false);
          setExpiresDirty(false);
        },
        onError: () => setErrorMsg("Could not save link settings. Try a different URL."),
      }
    );
  }, [albumID, effectiveSlug, effectiveExpires, slugDirty, expiresDirty, toggleAlbumPublic, refetch]);

  const openLink = useCallback(() => {
    if (slugLink) window.open(slugLink, "_blank", "noopener,noreferrer");
  }, [slugLink]);

  return (
    <>
      <Group mt="sm" align="flex-end">
        <TextInput
          style={{ flexGrow: 1 }}
          value={slugLink || "Generating..."}
          readOnly
          leftSection={<LinkIcon size={16} />}
        />
        <Tooltip label={copied ? "Copied" : "Copy link"} opened={copied ? true : undefined}>
          <ActionIcon
            variant="light"
            size="lg"
            aria-label="Copy slug link"
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
        <Tooltip label="Open public link">
          <ActionIcon variant="light" size="lg" aria-label="Open public link" disabled={!slugLink} onClick={openLink}>
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
          <Group>
            <Button variant="default" disabled={!canSave} onClick={onSave}>
              Save link settings
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
