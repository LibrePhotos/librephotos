import { Button, Dialog, Group, NumberInput, Select, Stack, Switch, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Settings as SettingIcon } from "tabler-icons-react";

import { fetchCountStats, fetchNextcloudDirectoryTree, fetchTimezoneList, updateUser } from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { ConfigDateTime } from "../../components/settings/ConfigDateTime";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function Settings() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const timezoneListRedux = useAppSelector(state => state.util.timezoneList);
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
    fetchTimezoneList(dispatch);
  }, [auth.access.user_id, dispatch]);

  useEffect(() => {
    setTimezoneList(timezoneListRedux);
  }, [timezoneListRedux]);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  return (
    <Stack align="center" justify="flex-start">
      <Group spacing="xs">
        <SettingIcon size={35} />
        <Title order={2}>{t("settings.header")}</Title>
      </Group>
      <Title order={3}>
        <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
      </Title>
      <Group position="center">
        <Select
          label={t("settings.sceneconfidence")}
          value={userSelfDetails.confidence?.toString()}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, confidence: value || "0" });
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
          value={userSelfDetails.semantic_search_topk?.toString()}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, semantic_search_topk: value || "0" });
          }}
          data={[
            { value: "100", label: t("settings.semanticsearch.top100") },
            { value: "50", label: t("settings.semanticsearch.top50") },
            { value: "10", label: t("settings.semanticsearch.top10") },
            { value: "0", label: t("settings.semanticsearch.top0") },
          ]}
        />
      </Group>
      <Title order={3}>
        <Trans i18nKey="settings.metadata">Metadata Options</Trans>
      </Title>
      <Group position="center">
        <Select
          label={t("settings.sync")}
          value={userSelfDetails.save_metadata_to_disk}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, save_metadata_to_disk: value || "OFF" });
          }}
          data={[
            { value: "OFF", label: t("settings.favoritesyncoptions.off") },
            { value: "SIDECAR_FILE", label: t("settings.favoritesyncoptions.sidecar") },
            { value: "MEDIA_FILE", label: t("settings.favoritesyncoptions.mediafile") },
          ]}
        />
        <Select
          label={t("settings.favoriteminimum")}
          value={userSelfDetails.favorite_min_rating?.toString()}
          placeholder={t("settings.favoriteoption.placeholder")}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, favorite_min_rating: value || "3" });
          }}
          data={[
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
          ]}
        />
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
      </Group>
      <Stack align="center">
        <Title order={3}>{t("settings.albumoptions")}</Title>
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
      </Stack>
      <Stack align="center">
        <ConfigDateTime
          value={userSelfDetails.datetime_rules}
          onChange={value => {
            setUserSelfDetails({ ...userSelfDetails, datetime_rules: value || "[]" });
          }}
        />
      </Stack>
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
      />
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
    </Stack>
  );
}
