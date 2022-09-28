import { Anchor, Button, Group, Stack, Text } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Photo } from "tabler-icons-react";

import type { Photo as PhotoType } from "../../actions/photosActions.types";
import { serverAddress } from "../../api_client/apiClient";
import { FileInfoComponent } from "./FileInfoComponent";

export function VersionComponent(props: { photoDetail: PhotoType }) {
  const { photoDetail } = props;

  const [showMore, setShowMore] = useState(false);
  const [duplicates, setDuplicates] = useState<PhotoType[]>([]);
  const [otherVersions, setOtherVersions] = useState<PhotoType[]>([]);
  const { t } = useTranslation();

  return (
    <Stack align="left">
      <Group position="apart">
        <Group position="left">
          <Photo />
          <div>
            <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
              {
                //To-Do: Fix oveflow
              }
              <Text weight={800} lineClamp={1}>
                {photoDetail.image_path.substring(photoDetail.image_path.lastIndexOf("/") + 1)}
              </Text>
            </Anchor>
            <Group>
              <FileInfoComponent info={`${photoDetail.height} x ${photoDetail.width}`} />
              {Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 ? (
                <FileInfoComponent info={`${Math.round((photoDetail.size / 1024) * 100) / 100} KB`} />
              ) : (
                <FileInfoComponent info={`${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`} />
              )}
            </Group>
          </div>
        </Group>
      </Group>
      {
        //To-Do: Fix oveflow
      }
      {photoDetail.camera && (
        <Group position="apart">
          <Group position="left">
            <Camera />
            <div>
              <Text weight={800}>{photoDetail.camera?.toString()}</Text>
              <Group spacing="xs">
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
            // To-Do: Add locales for exif data
            // To-Do: Add a type e.g. RAW, serial image, ai etc
            // To-Do: Make it more compact like immich
          }
          <FileInfoComponent description="File Path" info={`${photoDetail.image_path}`} />
          <FileInfoComponent description="Subject Distance" info={`${photoDetail.subjectDistance} m`} />
          <FileInfoComponent description="Digital Zoom Ratio" info={photoDetail.digitalZoomRatio?.toString()} />
          <FileInfoComponent
            description="Focal Length 35mm Equivalent"
            info={`${photoDetail.focalLength35Equivalent} mm`}
          />

          {
            // To-Do: xmp should only be "Type: xmp" and the different file path if it's in a different folder
            // To-Do: Show if there is a jpeg to the raw file
          }
          {otherVersions.length > 0 && <Text weight={800}>Other Versions</Text>}
          {
            // To-Do: If there is more then one version, show them here
            // To-Do: If it is serial images, show a thumbnail, type and file path. Should be selectable as the current version
            // To-Do: Same goes for stable diffusion images or upressed images
          }
          {duplicates.length > 0 && <Text weight={800}>Duplicates</Text>}
          {
            // To-Do: Duplicate should only say "Type: Duplicate" and the different file path
            // To-Do: If it's a duplicate, it should be possible to delete it
          }
        </Stack>
      )}
      <Button onClick={() => setShowMore(!showMore)} variant="subtle" size="xs" compact>
        {showMore ? "Show Less" : "Show More"}
      </Button>
    </Stack>
  );
}
