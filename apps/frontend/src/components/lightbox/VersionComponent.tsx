import { Anchor, Button, Divider, Group, Modal, Stack, Text } from "@mantine/core";
import { IconCamera as Camera, IconPhoto as Photo } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Photo as PhotoType } from "../../actions/photosActions.types";
import { serverAddress } from "../../api_client/apiClient";
import { useDeleteDuplicatePhotoMutation } from "../../api_client/photos/delete";
import { FileInfoComponent } from "./FileInfoComponent";

export function VersionComponent(props: Readonly<{ photoDetail: PhotoType; isPublic: boolean }>) {
  const { photoDetail, isPublic } = props;

  const [showMore, setShowMore] = useState(false);
  const [otherVersions] = useState<PhotoType[]>([]);
  const [openDeleteDialogState, setOpenDeleteDialogState] = useState(false);
  const [imageHash, setImageHash] = useState("");
  const [path, setPath] = useState("");
  const { t } = useTranslation();
  const [deleteDuplicatePhoto] = useDeleteDuplicatePhotoMutation();

  const openDeleteDialog = (hash, filePath) => {
    setOpenDeleteDialogState(true);
    setImageHash(hash);
    setPath(filePath);
  };

  const duplicates = photoDetail.image_path.slice(1);

  return (
    <div>
      <Stack align="left">
        <Group justify="apart">
          <Group justify="left">
            <Photo />
            <div>
              <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
                <Text fw={800} lineClamp={1} style={{ maxWidth: 225 }}>
                  {photoDetail.image_path[0].substring(photoDetail.image_path[0].lastIndexOf("/") + 1)}
                </Text>
              </Anchor>
              <Group>
                <FileInfoComponent info={`${photoDetail.height} x ${photoDetail.width}`} />
                {Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 ? (
                  <FileInfoComponent info={`${Math.round((photoDetail.size / 1024) * 100) / 100} kB`} />
                ) : (
                  <FileInfoComponent info={`${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`} />
                )}
              </Group>
            </div>
          </Group>
        </Group>
        {photoDetail.camera && (
          <Group justify="apart">
            <Group justify="left">
              <Camera />
              <div>
                <Text fw={800}>{photoDetail.camera?.toString()}</Text>
                <Group gap="xs">
                  <FileInfoComponent info={photoDetail.lens?.toString()} />
                  <FileInfoComponent info={`${photoDetail.subjectDistance} m`} />
                  <FileInfoComponent info={`ƒ / ${photoDetail.fstop}`} />
                  <FileInfoComponent info={`${photoDetail.shutter_speed}`} />
                  <FileInfoComponent info={`${Math.round(photoDetail.focal_length!)} mm`} />
                  <FileInfoComponent info={`ISO${photoDetail.iso?.toString()}`} />
                </Group>
              </div>
            </Group>
          </Group>
        )}
        {showMore && (
          <Stack>
            {
              // To-Do: Add a type e.g. RAW, serial image, ai etc
            }
            {!isPublic && <FileInfoComponent description={t("exif.filepath")} info={`${photoDetail.image_path[0]}`} />}
            <FileInfoComponent description={t("exif.subjectdistance")} info={`${photoDetail.subjectDistance} m`} />
            <FileInfoComponent
              description={t("exif.digitalzoomratio")}
              info={photoDetail.digitalZoomRatio?.toString()}
            />
            <FileInfoComponent
              description={t("exif.focallengthin35mmfilm")}
              info={`${photoDetail.focalLength35Equivalent} mm`}
            />

            {
              // To-Do: xmp should only be "Type: xmp" and the different file path if it's in a different folder
              // To-Do: Show if there is a jpeg to the raw file
              // To-Do: Differentiate XMPs and duplicates in the backend
            }
            {otherVersions.length > 0 && <Text fw={800}>{t("exif.otherversions")}</Text>}
            {
              // To-Do: If there is more then one version, show them here
              // To-Do: If it is serial images, show a thumbnail, type and file path. Should be selectable as the current version
              // To-Do: Same goes for stable diffusion images or upressed images
            }
            {duplicates.length > 0 && <Text fw={800}>{t("exif.duplicates")}</Text>}
            {duplicates.map(element => (
              <Stack>
                <FileInfoComponent description={t("exif.filepath")} info={`${element}`} />
                <Button color="red" onClick={() => openDeleteDialog(photoDetail.image_hash, element)}>
                  {t("delete")}
                </Button>
                {/**
                                 <Group>
                                 // To-Do: Change a path to the primary file
                                 // To-Do: Implement endpoint
                                 <Button color="green">Change to primary</Button>
                                 // To-Do: Use a ActionIcon instead?
                                 </Group> */}
                <Divider my="sm" />
              </Stack>
            ))}
          </Stack>
        )}
        <Button onClick={() => setShowMore(!showMore)} variant="subtle" size="compact-xs">
          {showMore ? t("exif.showless") : t("exif.showmore")}
        </Button>
      </Stack>
      <Modal
        opened={openDeleteDialogState}
        title={t("exif.deleteduplicatetitle")}
        onClose={() => setOpenDeleteDialogState(false)}
        zIndex={1000}
      >
        <Text size="sm">{t("exif.deleteduplicate")}</Text>
        <Group>
          <Button
            onClick={() => {
              setOpenDeleteDialogState(false);
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              deleteDuplicatePhoto({ image_hash: imageHash, path });
              setOpenDeleteDialogState(false);
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
