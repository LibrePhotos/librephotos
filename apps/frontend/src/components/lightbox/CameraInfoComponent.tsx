import { Group, Text } from "@mantine/core";
import { IconCamera as Camera } from "@tabler/icons-react";
import React from "react";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { FileInfoComponent } from "./FileInfoComponent";

/**
 * Display camera equipment and settings information
 */
export function CameraInfoComponent({ photoDetail }: { photoDetail: PhotoType }) {
  if (!photoDetail.camera) return null;

  return (
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
  );
}
