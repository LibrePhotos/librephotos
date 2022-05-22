import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { push } from "connected-react-router";
import * as moment from "moment";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";
// only needs to be imported once
import { Form, Icon, Image, Item, Label } from "semantic-ui-react";
import { Edit, File, Note, X } from "tabler-icons-react";

import { generatePhotoIm2txtCaption } from "../../actions/photosActions";
import { searchPhotos } from "../../actions/searchActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { LocationMap } from "../LocationMap";
import { Tile } from "../Tile";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { TimestampItem } from "./TimestampItem";

let LIGHTBOX_SIDEBAR_WIDTH = 320;
if (window.innerWidth < 600) {
  LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
}
type Props = {
  isPublic: boolean;
  photoDetail: any;
  closeSidepanel: () => void;
};

export const Sidebar = (props: Props) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<any[]>([]);
  const { generatingCaptionIm2txt } = useAppSelector(store => store.photos);
  const { photoDetail, isPublic, closeSidepanel } = props;
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
              <X></X>
            </ActionIcon>
          </Group>
          {/* Start Item Time Taken */}
          <TimestampItem photoDetail={photoDetail} dispatch={dispatch} />
          {/* End Item Time Taken */}
          {/* Start Item File Path */}
          <Group>
            <File />
            <Title order={4}>{t("lightbox.sidebar.filepath")}</Title>
          </Group>
          <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}.jpg`} target="_blank">
            <Text size="sm">{photoDetail.image_path} </Text>
          </Anchor>

          {/* End Item File Path */}
          {/* Start Item Location */}

          {photoDetail.search_location && (
            <Item>
              <Item.Content verticalAlign="middle">
                <Title order={4}>
                  <Icon name="point" /> {t("lightbox.sidebar.location")}
                </Title>
                <Text>{photoDetail.search_location}</Text>
              </Item.Content>
            </Item>
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
                <Icon name="users" />
                <Title order={4}>{t("lightbox.sidebar.people")}</Title>
              </Group>
              {photoDetail.people.map((nc, idx) => (
                <Group position="center" spacing="xs">
                  <Button
                    variant="subtle"
                    leftIcon={<Avatar radius="xl" src={serverAddress + nc.face_url} />}
                    onClick={() => {
                      dispatch(searchPhotos(nc.name));
                      dispatch(push("/search"));
                    }}
                  >
                    <Text align="center" size="sm">
                      {nc.name}
                    </Text>
                  </Button>
                  <ActionIcon
                    onClick={() => {
                      setSelectedFaces([{ face_id: nc.face_id, face_url: nc.face_url }]);
                      setPersonEditOpen(true);
                    }}
                    variant="light"
                  >
                    <Edit size={17} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}

          {/* End Item People */}
          {/* Start Item Caption */}

          <Item>
            <Item.Content verticalAlign="middle">
              <Group>
                <Note></Note>
                <Title order={4}>{t("lightbox.sidebar.caption")}</Title>
              </Group>
              <Text>
                {false && photoDetail.captions_json.im2txt}
                <Form>
                  <Form.TextArea disabled={isPublic} fluid placeholder={photoDetail.captions_json.im2txt}>
                    {photoDetail.captions_json.im2txt}
                  </Form.TextArea>
                  <Group>
                    <Button disabled={isPublic} size="sm" color="green">
                      {t("lightbox.sidebar.submit")}
                    </Button>
                    <Button
                      loading={generatingCaptionIm2txt}
                      onClick={() => {
                        dispatch(generatePhotoIm2txtCaption(photoDetail.image_hash));
                      }}
                      disabled={isPublic || (generatingCaptionIm2txt != null && generatingCaptionIm2txt)}
                      size="sm"
                      color="blue"
                    >
                      {t("lightbox.sidebar.generate")}
                    </Button>
                    <Button disabled={isPublic} size="sm">
                      {t("lightbox.sidebar.cancel")}
                    </Button>
                  </Group>
                </Form>
              </Text>
            </Item.Content>
          </Item>

          {/* End Item Caption */}
          {/* Start Item Scene */}
          {photoDetail.captions_json.places365 && (
            <Stack>
              <Title order={4}>
                <Icon name="tags" /> {t("lightbox.sidebar.scene")}
              </Title>
              <Text>
                <p>
                  <b>{t("lightbox.sidebar.attributes")}</b>
                </p>
                <Group>
                  {photoDetail.captions_json.places365.attributes.map((nc, idx) => (
                    <Badge
                      key={`lightbox_attribute_label_${photoDetail.image_hash}_${nc}`}
                      color="blue"
                      onClick={() => {
                        dispatch(searchPhotos(nc));
                        dispatch(push("/search"));
                      }}
                    >
                      {nc}
                    </Badge>
                  ))}
                </Group>

                <p>
                  <b>{t("lightbox.sidebar.categories")}</b>
                </p>
                <Group>
                  {photoDetail.captions_json.places365.categories.map((nc, idx) => (
                    <Badge
                      key={`lightbox_category_label_${photoDetail.image_hash}_${nc}`}
                      color="teal"
                      onClick={() => {
                        dispatch(searchPhotos(nc));
                        dispatch(push("/search"));
                      }}
                    >
                      {nc}
                    </Badge>
                  ))}
                </Group>
              </Text>
            </Stack>
          )}
          {/* End Item Scene */}
          {/* Start Item Similar Photos */}
          {photoDetail.similar_photos.length > 0 && (
            <div>
              <Icon name="images" />
              <Title order={4}>{t("lightbox.sidebar.similarphotos")}</Title>
              <Text>
                <Image.Group>
                  {photoDetail.similar_photos.slice(0, 30).map(el => (
                    <Tile video={el.type.includes("video")} height={95} width={95} image_hash={el.image_hash} />
                  ))}
                  ;
                </Image.Group>
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
        }}
        selectedFaces={selectedFaces}
      />
    </Box>
  );
};
