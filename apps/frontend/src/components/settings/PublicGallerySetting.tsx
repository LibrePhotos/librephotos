import type { GalleryPreview } from "@librephotos/api-client";
import { Anchor, Card, SegmentedControl, Stack, Switch, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPreviewQuery } from "../../api_client/gallery/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { sharerName } from "../sharing/sharerGroups";
import { SectionLink } from "./SettingsSection";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

type Stage = "off" | "members" | "everyone";
const STAGES: readonly Stage[] = ["off", "members", "everyone"];
// The confirm names this many photographers, then "and n more".
const NAMED = 5;

function stageOf(value: string | undefined): Stage {
  return STAGES.find(stage => stage === value) ?? "off";
}

/** Whether `next` shows the gallery to people who could not see it under `stored`. */
export function opensWider(stored: Stage, next: Stage): boolean {
  return STAGES.indexOf(next) > STAGES.indexOf(stored);
}

/** The confirm's sentence on what goes out: counts and the photographers with the most photos. */
export function previewSentence(preview: GalleryPreview | undefined, failed: boolean, t: TFunction): string {
  if (failed) return t("sitesettings.publicGalleryCountFailed");
  if (!preview) return t("sitesettings.publicGalleryCounting");
  if (preview.photographer_count === 0) return t("sitesettings.publicGalleryNone");
  const names = preview.photographers
    .slice(0, NAMED)
    .map(photographer => `${sharerName(photographer, photographer.username)} (${photographer.photo_count})`)
    .join(", ");
  const more = preview.photographer_count - Math.min(NAMED, preview.photographers.length);
  return t("sitesettings.publicGalleryPublishes", {
    photos: t("gallery.photoCount", { count: preview.photo_count }),
    photographers: t("gallery.photographerCount", { count: preview.photographer_count }),
    names: more > 0 ? t("sitesettings.publicGalleryNamesMore", { names, count: more }) : names,
  });
}

/**
 * The public gallery's card on the Admin page (#434): off (the default), members only,
 * or everyone, and whether search engines may index it. Opening it wider first asks, naming how many
 * photos of how many users go out. Hidden for an older backend that has no gallery.
 */
export function PublicGallerySetting() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const [pending, setPending] = useState<Stage | null>(null);
  const [confirmOpen, { open, close }] = useDisclosure(false);
  const preview = useGalleryPreviewQuery(confirmOpen);
  if (settings?.public_gallery === undefined) return null;
  const stored = stageOf(settings.public_gallery);

  const change = (value: string) => {
    const next = stageOf(value);
    if (!opensWider(stored, next)) {
      save({ public_gallery: next });
      return;
    }
    setPending(next);
    open();
  };
  const confirm = () => {
    if (pending !== null) save({ public_gallery: pending });
    close();
  };
  const audience =
    pending === "everyone" ? "sitesettings.publicGalleryToEveryone" : "sitesettings.publicGalleryToMembers";

  return (
    <Card shadow="md">
      <Stack gap="sm">
        <Title order={4}>
          {t("sitesettings.publicGallery")}
          <SectionLink />
        </Title>
        <Text fz="sm" c="dimmed">
          {t("sitesettings.publicGalleryDescription")}{" "}
          {stored !== "off" && (
            <Anchor component={Link} to="/public" fz="sm">
              {t("gallery.open")}
            </Anchor>
          )}
        </Text>
        <SegmentedControl
          aria-label={t("sitesettings.publicGallery")}
          value={stored}
          onChange={change}
          data={[
            { value: "off", label: t("sitesettings.publicGalleryOff") },
            { value: "members", label: t("sitesettings.publicGalleryMembers") },
            { value: "everyone", label: t("sitesettings.publicGalleryEveryone") },
          ]}
        />
        {stored !== "off" && (
          <Switch
            mt="xs"
            label={t("sitesettings.publicGalleryIndexable")}
            description={t("sitesettings.publicGalleryIndexableDescription")}
            checked={settings.public_gallery_indexable === true}
            onChange={() => save({ public_gallery_indexable: settings.public_gallery_indexable !== true })}
          />
        )}
        <ConfirmModal
          opened={confirmOpen}
          onClose={close}
          onConfirm={confirm}
          title={t("sitesettings.publicGalleryConfirmTitle")}
          message={`${t(audience)} ${previewSentence(preview.data, preview.isError, t)} ${t("sitesettings.publicGalleryConfirmNote")}`}
          confirmLabel={t("sitesettings.publicGalleryConfirmButton")}
          confirmColor="blue"
        />
      </Stack>
    </Card>
  );
}
