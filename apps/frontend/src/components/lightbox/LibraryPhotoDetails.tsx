import { Avatar, Button, Group, Stack, Text } from "@mantine/core";
import {
  IconCamera,
  IconDownload,
  IconEyeOff,
  IconMapPin,
  IconTextCaption,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { firstName, personName, type LibraryPhoto } from "../libraryShare/libraryShareFields";
import { CameraInfoSection } from "./CameraInfoSection";
import { Description } from "./Description";
import type { FaceLocationType } from "./lightbox.types";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { TimestampItem } from "./TimestampItem";

type Props = Readonly<{
  photo: LibraryPhoto;
  setFaceLocation: (location: FaceLocationType) => void;
}>;

const ignore = () => {};

// No file names are shared: a download is named by the photo's hash. A copy of a still is a JPEG.
function downloadName(photo: LibraryPhoto): string {
  return photo.shared_library.originals || photo.video ? photo.image_hash : `${photo.image_hash}.jpg`;
}

/** A field the owner does not share: says that it is hidden and who decided, in words. */
function HiddenNote({ icon: NoteIcon, text }: Readonly<{ icon: Icon; text: string }>) {
  return (
    <Group gap="xs" wrap="nowrap">
      <NoteIcon size={18} stroke={1.5} aria-hidden />
      <IconEyeOff size={14} color="var(--mantine-color-dimmed)" aria-hidden />
      <Text size="sm" c="dimmed">
        {text}
      </Text>
    </Group>
  );
}

/**
 * The details of a photo in a library someone shares with me (#2731): whose it is, its date, and
 * each field the owner shares; every other field says the owner does not share it.
 */
export function LibraryPhotoDetails({ photo, setFaceLocation }: Props) {
  const { t } = useTranslation();
  const grant = photo.shared_library;
  const name = personName(photo.owner);
  const first = firstName(photo.owner);
  return (
    <Stack>
      <Group gap="sm" wrap="nowrap">
        <Avatar radius="xl" size="md" name={name} color="initials" />
        <div>
          <Text fw={500} size="sm">
            {t("librarySharing.photoOf", { name })}
          </Text>
          <Text size="xs" c="dimmed">
            {t("librarySharing.sharedReadOnly")}
          </Text>
        </div>
      </Group>
      <TimestampItem photoDetail={photo} isPublic />
      {grant.location ? (
        <LocationSection photoDetail={photo} mapHeight={200} isPublic />
      ) : (
        <HiddenNote icon={IconMapPin} text={t("librarySharing.hiddenLocation", { name: first })} />
      )}
      {!grant.people && <HiddenNote icon={IconUsers} text={t("librarySharing.hiddenPeople", { name: first })} />}
      {grant.people && photo.people.length > 0 && (
        <PeopleSection
          photoDetail={photo}
          isPublic
          setFaceLocation={setFaceLocation}
          onPersonEdit={ignore}
          notThisPerson={ignore}
        />
      )}
      {!grant.camera && <HiddenNote icon={IconCamera} text={t("librarySharing.hiddenCamera", { name: first })} />}
      {grant.camera && photo.camera && <CameraInfoSection photoDetail={photo} />}
      {grant.captions ? (
        <Description photoDetail={photo} isPublic />
      ) : (
        <HiddenNote icon={IconTextCaption} text={t("librarySharing.hiddenCaptions", { name: first })} />
      )}
      <Group gap="sm" wrap="nowrap">
        <Button
          component="a"
          href={mediaUrl.photo(photo.image_hash)}
          download={downloadName(photo)}
          variant="default"
          size="xs"
          leftSection={<IconDownload size={14} />}
        >
          {t("librarySharing.download")}
        </Button>
        {!grant.originals && (
          <Text size="xs" c="dimmed">
            {t("librarySharing.copiesOnlyNote")}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
