import { Button, Dialog, Group, Select, Stack, Switch, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Settings as SettingIcon } from "tabler-icons-react";

import {
  fetchCountStats,
  fetchJobList,
  fetchNextcloudDirectoryTree,
  fetchSiteSettings,
  updateUser,
} from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { ConfigDatetime } from "../../components/settings/ConfigDatetime";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const Settings = () => {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState({} as any);
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const workerAvailability = useAppSelector(state => state.util.workerAvailability);
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
    fetchSiteSettings(dispatch);
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    dispatch(fetchNextcloudDirectoryTree("/"));
    if (auth.access.is_admin) {
      dispatch(fetchJobList());
    }
  }, []);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  let buttonsDisabled = !workerAvailability;
  buttonsDisabled = false;
  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }
  return (
    <Stack align="center" justify="flex-start">
      <Group spacing="xs">
        <SettingIcon size={35} />
        <Title order={2}>{t("settings.header")}</Title>
      </Group>
      <Title order={3}>
        <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
      </Title>
      <Group>
        <Select
          label={t("settings.sceneconfidence")}
          value={userSelfDetails.confidence}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, confidence: value });
          }}
          placeholder={t("settings.confidencelevel")}
          data={[
            { value: "0.5", label: t("settings.confidence.high") },
            { value: "0.1", label: t("settings.confidence.standard") },
            { value: "0.05", label: t("settings.confidence.low") },
            { value: "0", label: t("settings.confidence.none") },
          ]}
        />
        <Select
          label={t("settings.semanticsearchheader")}
          placeholder={t("settings.semanticsearch.placeholder")}
          value={userSelfDetails.semantic_search_topk}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, semantic_search_topk: value });
          }}
          data={[
            { value: "100", label: t("settings.semanticsearch.top100") },
            { value: "50", label: t("settings.semanticsearch.top50") },
            { value: "10", label: t("settings.semanticsearch.top10") },
            { value: "0", label: t("settings.semanticsearch.top0") },
          ]}
        ></Select>
      </Group>
      <Title order={3}>
        <Trans i18nKey="settings.metadata">Metadata options</Trans>
      </Title>
      <Group>
        <Select
          label={t("settings.sync")}
          value={userSelfDetails.save_metadata_to_disk}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, save_metadata_to_disk: value });
          }}
          data={[
            { value: "OFF", label: t("settings.favoritesyncoptions.off") },
            { value: "SIDECAR_FILE", label: t("settings.favoritesyncoptions.sidecar") },
            { value: "MEDIA_FILE", label: t("settings.favoritesyncoptions.mediafile") },
          ]}
        ></Select>
        <Select
          label={t("settings.favoriteminimum")}
          value={userSelfDetails.save_metadata_to_disk}
          placeholder={t("settings.favoriteoption.placeholder")}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, favorite_min_rating: value });
          }}
          data={[
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
          ]}
        ></Select>
      </Group>
      <ConfigDatetime />
      <Title order={3}>
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
      ></Switch>
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
          Save Changes?
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
              dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
              setIsOpenUpdateDialog(false);
            }}
          >
            <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
          </Button>
          <Button
            onClick={() => {
              setUserSelfDetails(userSelfDetails);
            }}
            size="sm"
          >
            <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
          </Button>
        </Group>
      </Dialog>
    </Stack>
  );
};
