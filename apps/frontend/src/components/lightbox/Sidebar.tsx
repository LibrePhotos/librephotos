import { ActionIcon, Avatar, Box, Button, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
// only needs to be imported once
import {
  IconEdit as Edit,
  IconMap2 as Map2,
  IconPhoto as Photo,
  IconUserOff as UserOff,
  IconUsers as Users,
  IconX as X,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";
import { push } from "redux-first-history";

import type { Photo as PhotoType } from "../../actions/photosActions.types";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { notification } from "../../service/notifications";
import { useAppDispatch } from "../../store/store";
import { LocationMap } from "../LocationMap";
import { Tile } from "../Tile";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { Description } from "./Description";
import { TimestampItem } from "./TimestampItem";
import { VersionComponent } from "./VersionComponent";

type Props = {
  isPublic: boolean;
  photoDetail: PhotoType;
  closeSidepanel: () => void;
};

export function Sidebar(props: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<any[]>([]);
  const { photoDetail, isPublic, closeSidepanel } = props;
  const { width } = useViewportSize();

  const SCROLLBAR_WIDTH = 15;
  let LIGHTBOX_SIDEBAR_WIDTH = 320;

  const notThisPerson = faceId => {
    const ids = [faceId];
    dispatch(api.endpoints.setFacesPersonLabel.initiate({ faceIds: ids, personName: "Unknown - Other" }));
    notification.removeFacesFromPerson(ids.length);
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoDetail.image_hash)).refetch();
  };

  if (width < 600) {
    LIGHTBOX_SIDEBAR_WIDTH = width - SCROLLBAR_WIDTH;
  }
  return (
    <Box
      sx={theme => ({
        backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
        padding: theme.spacing.sm,
      })}
      style={{
        right: 0,
        top: 0,
        float: "right",
        width: LIGHTBOX_SIDEBAR_WIDTH,
        height: window.innerHeight,
        whiteSpace: "normal",
        position: "fixed",
        overflowY: "scroll",
        overflowX: "hidden",
        zIndex: 250,
      }}
    >
      {photoDetail && (
        <Stack>
          <Group position="apart">
            <Title order={3}>Details</Title>
            <ActionIcon
              onClick={() => {
                closeSidepanel();
              }}
            >
              <X />
            </ActionIcon>
          </Group>
          {/* Start Item Time Taken */}
          <TimestampItem photoDetail={photoDetail} isPublic={isPublic} />
          {/* End Item Time Taken */}
          {/* Start Item File Path */}
          <VersionComponent photoDetail={photoDetail} isPublic={isPublic} />
          {/* End Item File Path */}
          {/* Start Item Location */}

          {photoDetail.search_location && (
            <Stack>
              <Title order={4}>
                <Map2 /> {t("lightbox.sidebar.location")}
              </Title>
              <Text>{photoDetail.search_location}</Text>
            </Stack>
          )}

          <div
            style={{
              width: LIGHTBOX_SIDEBAR_WIDTH - 70,
              whiteSpace: "normal",
              lineHeight: "normal",
            }}
          >
            {photoDetail.exif_gps_lat && <LocationMap photos={[photoDetail]} />}
          </div>

          {/* End Item Location */}
          {/* Start Item People */}

          {photoDetail.people.length > 0 && (
            <Stack>
              <Group>
                <Users />
                <Title order={4}>{t("lightbox.sidebar.people")}</Title>
              </Group>
              {photoDetail.people.map(nc => (
                <Group position="center" spacing="xs" key={`${nc.name}`}>
                  <Button
                    variant="subtle"
                    leftIcon={<Avatar radius="xl" src={serverAddress + nc.face_url} />}
                    onClick={() => {
                      if (isPublic) {
                        return;
                      }
                      dispatch(push(`/search/${nc.name}`));
                    }}
                  >
                    <Text align="center" size="sm">
                      {nc.name}
                    </Text>
                  </Button>
                  {!isPublic && (
                    <ActionIcon
                      onClick={() => {
                        setSelectedFaces([{ face_id: nc.face_id, face_url: nc.face_url }]);
                        setPersonEditOpen(true);
                      }}
                      variant="light"
                    >
                      <Edit size={17} />
                    </ActionIcon>
                  )}
                  {!isPublic && (
                    <Tooltip label={t("facesdashboard.notthisperson")}>
                      <ActionIcon variant="light" color="orange" onClick={() => notThisPerson(nc.face_id)}>
                        <UserOff />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              ))}
            </Stack>
          )}

          {/* End Item People */}
          {/* Start Item Caption */}
          <Description photoDetail={photoDetail} isPublic={isPublic} />

          {/* Start Item Similar Photos */}
          {photoDetail.similar_photos.length > 0 && (
            <div>
              <Group>
                <Photo />
                <Title order={4}>{t("lightbox.sidebar.similarphotos")}</Title>
              </Group>
              <Text>
                <Group spacing="xs">
                  {photoDetail.similar_photos.slice(0, 30).map(el => (
                    <Tile video={el.type.includes("video")} height={85} width={85} image_hash={el.image_hash} />
                  ))}
                </Group>
              </Text>
            </div>
          )}
          {/* End Item Similar Photos */}
        </Stack>
      )}
      <ModalPersonEdit
        isOpen={personEditOpen}
        onRequestClose={() => {
          setPersonEditOpen(false);
          setSelectedFaces([]);
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoDetail.image_hash)).refetch();
        }}
        selectedFaces={selectedFaces}
      />
    </Box>
  );
}
