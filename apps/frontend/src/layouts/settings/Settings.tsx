import { Button, Card, Container, Dialog, Flex, Group, NumberInput, Radio, Select, Stack, Switch, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Settings as SettingIcon } from "tabler-icons-react";

import {
  fetchCountStats,
  fetchJobList,
  fetchNextcloudDirectoryTree,
  fetchTimezoneList,
  updateUser,
} from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { ConfigDateTime } from "../../components/settings/ConfigDateTime";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function Settings() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const timezoneListRedux = useAppSelector(state => state.util.timezoneList);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState(userSelfDetailsRedux);
  const [timezoneList, setTimezoneList] = useState(timezoneListRedux);
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { t } = useTranslation();

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(userSelfDetailsRedux) !== JSON.stringify(userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetailsRedux, userSelfDetails]);

  useEffect(() => {
    dispatch(fetchCountStats());
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id)).refetch();
    dispatch(fetchNextcloudDirectoryTree("/"));
    if (auth.access.is_admin) {
      dispatch(fetchJobList());
    }
    fetchTimezoneList(dispatch);
  }, [auth.access.is_admin, auth.access.user_id, dispatch]);

  useEffect(() => {
    setTimezoneList(timezoneListRedux);
  }, [timezoneListRedux]);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }

  return (
    <Container>
      <Group spacing="xs" sx={{'marginBottom': 20, 'marginTop': 40}}>
        <SettingIcon size={35} />
        <Title order={1}>{t("settings.header")}</Title>
      </Group>
      <Stack>
        <Card shadow="md">
          <Title order={4} sx={{'marginBottom': 16}}>
            <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
          </Title>
          <Flex align="left" direction="column" gap={16}>
            <Radio.Group
              description={t("settings.confidencelevel")}
              label={t("settings.sceneconfidence")}
              value={userSelfDetails.confidence?.toString() || "0"}
              onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, confidence: value || "0" });
            }}>
              <Radio value="0.5" label={t("settings.confidence.high")} />
              <Radio value="0.1" label={t("settings.confidence.standard")} />
              <Radio value="0.05" label={t("settings.confidence.low")} />
              <Radio value="0" label={t("settings.confidence.none")} />
            </Radio.Group>
            <Radio.Group
              label={t("settings.semanticsearchheader")}
              description={t("settings.semanticsearch.placeholder")}
              value={userSelfDetails.semantic_search_topk?.toString()}
              onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, semantic_search_topk: value || "0" });
            }}>
              <Radio value="100" label={t("settings.semanticsearch.top100")} />
              <Radio value="50" label={t("settings.semanticsearch.top50")} />
              <Radio value="10" label={t("settings.semanticsearch.top10")} />
              <Radio value="0" label={t("settings.semanticsearch.top0")} />
            </Radio.Group>
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} sx={{'marginBottom': 16}}>
            <Trans i18nKey="settings.metadata">Metadata</Trans>
          </Title>
          <Flex align="left" direction="column" gap={16}>
            <Radio.Group
              label={t("settings.sync")}
              value={userSelfDetails.save_metadata_to_disk}
              onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, save_metadata_to_disk: value || "OFF" });
            }}>
              <Radio value="OFF" label={t("settings.favoritesyncoptions.off")} />
              <Radio value="SIDECAR_FILE" label={t("settings.favoritesyncoptions.sidecar")} />
              <Radio value="MEDIA_FILE" label={t("settings.favoritesyncoptions.mediafile")} />
            </Radio.Group>
            <Radio.Group
              label={t("settings.favoriteminimum")}
              value={userSelfDetails.favorite_min_rating?.toString()}
              onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, favorite_min_rating: value || "3" });
            }}>
              <Radio value="1" label="1" />
              <Radio value="2" label="2" />
              <Radio value="3" label="3" />
              <Radio value="4" label="4" />
              <Radio value="5" label="5" />
            </Radio.Group>
            <Select
              label={t("defaulttimezone")}
              value={userSelfDetails.default_timezone}
              placeholder={t("defaulttimezone")}
              searchable
              title={t("timezoneexplain")}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, default_timezone: value || "UTC" });
              }}
              data={timezoneList}
            />
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} sx={{'marginBottom': 16}}>{t("settings.albumoptions")}</Title>
          <NumberInput
            label={t("settings.inferredfacesconfidence")}
            description={t("settings.inferredfacesconfidencehelp")}
            min={0}
            max={1.0}
            placeholder="0.90"
            precision={2}
            value={userSelfDetails.confidence_person}
            hideControls
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, confidence_person: value });
            }}
          />
        </Card>
        <Card shadow="md">
          <ConfigDateTime
            value={userSelfDetails.datetime_rules}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, datetime_rules: value || "[]" });
            }}
          />
        </Card>
        <Card shadow="md">
          <Title order={4} sx={{'marginBottom': 16}}>
            <Trans i18nKey="settings.experimentaloptions">Experimental options</Trans>
          </Title>
          <Switch
            label={t("settings.transcodevideo")}
            checked={userSelfDetails.transcode_videos}
            onChange={event => {
              setUserSelfDetails({
                ...userSelfDetails,
                transcode_videos: event.currentTarget.checked,
              });
            }}
          />
        </Card>
      </Stack>
      <ModalNextcloudScanDirectoryEdit
        onRequestClose={() => {
          setModalNextcloudScanDirectoryOpen(false);
        }}
        userToEdit={userSelfDetails}
        isOpen={modalNextcloudScanDirectoryOpen}
      />
      <Dialog
        opened={isOpenUpdateDialog}
        withCloseButton
        onClose={() => setIsOpenUpdateDialog(false)}
        size="lg"
        radius="md"
      >
        <Text size="sm" style={{ marginBottom: 10 }} weight={500}>
          {t("settings.savechanges")}
        </Text>

        <Group align="flex-end">
          <Button
            size="sm"
            color="green"
            onClick={() => {
              const newUserData = userSelfDetails;
              delete newUserData.scan_directory;
              delete newUserData.avatar;
              updateUser(newUserData, dispatch);
              setIsOpenUpdateDialog(false);
            }}
          >
            <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
          </Button>
          <Button
            onClick={() => {
              setUserSelfDetails(userSelfDetailsRedux);
              setIsOpenUpdateDialog(false);
            }}
            size="sm"
          >
            <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
          </Button>
        </Group>
      </Dialog>
    </Container>
  );
}
