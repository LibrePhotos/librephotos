import {
  Button,
  Card,
  Container,
  Dialog,
  Flex,
  Group,
  NumberInput,
  Radio,
  Select,
  Space,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { IconSettings as SettingIcon } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { updateUser } from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { useFetchTimezonesQuery } from "../../api_client/util";
import { ConfigDateTime } from "../../components/settings/ConfigDateTime";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function Settings() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const [userSelfDetails, setUserSelfDetails] = useState(userSelfDetailsRedux);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { t } = useTranslation();
  const { data: timezoneList = [] } = useFetchTimezonesQuery();

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(userSelfDetailsRedux) !== JSON.stringify(userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetailsRedux, userSelfDetails]);

  useEffect(() => {
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id)).refetch();
  }, [auth.access.user_id, dispatch]);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  return (
    <Container>
      <Group spacing="xs" sx={{ marginBottom: 20, marginTop: 40 }}>
        <SettingIcon size={35} />
        <Title order={1}>{t("settings.header")}</Title>
      </Group>
      <Stack>
        <Card shadow="md">
          <Title order={4} sx={{ marginBottom: 16 }}>
            <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Radio.Group
              description={t("settings.confidencelevel")}
              label={t("settings.sceneconfidence")}
              value={userSelfDetails.confidence?.toString() || "0"}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, confidence: value || "0" });
              }}
            >
              <Group mt="xs">
                <Radio value="0.5" label={t("settings.confidence.high")} />
                <Radio value="0.1" label={t("settings.confidence.standard")} />
                <Radio value="0.05" label={t("settings.confidence.low")} />
                <Radio value="0" label={t("settings.confidence.none")} />
              </Group>
            </Radio.Group>
            <Radio.Group
              label={t("settings.semanticsearchheader")}
              description={t("settings.semanticsearch.placeholder")}
              value={userSelfDetails.semantic_search_topk?.toString()}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, semantic_search_topk: value || "0" });
              }}
            >
              <Group mt="xs">
                <Radio value="100" label={t("settings.semanticsearch.top100")} />
                <Radio value="50" label={t("settings.semanticsearch.top50")} />
                <Radio value="10" label={t("settings.semanticsearch.top10")} />
                <Radio value="0" label={t("settings.semanticsearch.top0")} />
              </Group>
            </Radio.Group>
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} sx={{ marginBottom: 16 }}>
            <Trans i18nKey="settings.metadata">Metadata</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Radio.Group
              label={t("settings.sync")}
              value={userSelfDetails.save_metadata_to_disk}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, save_metadata_to_disk: value || "OFF" });
              }}
            >
              <Group mt="xs">
                <Radio value="OFF" label={t("settings.favoritesyncoptions.off")} />
                <Radio value="SIDECAR_FILE" label={t("settings.favoritesyncoptions.sidecar")} />
                <Radio value="MEDIA_FILE" label={t("settings.favoritesyncoptions.mediafile")} />
              </Group>
            </Radio.Group>
            <Radio.Group
              label={t("settings.favoriteminimum")}
              value={userSelfDetails.favorite_min_rating?.toString()}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, favorite_min_rating: value || "3" });
              }}
            >
              <Group mt="xs">
                <Radio value="1" label="1" />
                <Radio value="2" label="2" />
                <Radio value="3" label="3" />
                <Radio value="4" label="4" />
                <Radio value="5" label="5" />
              </Group>
            </Radio.Group>
            <Select
              label={t("defaulttimezone")}
              value={userSelfDetails.default_timezone}
              placeholder={t("defaulttimezone")}
              searchable
              title={t("timezoneexplain")}
              onChange={value => {
                setUserSelfDetails({ ...userSelfDetails, default_timezone: value ?? "UTC" });
              }}
              data={timezoneList}
            />
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} sx={{ marginBottom: 16 }}>
            {t("settings.albumoptions")}
          </Title>
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
          <Title order={4} sx={{ marginBottom: 16 }}>
            {t("settings.face_options")}
          </Title>
          <Radio.Group
            label={t("settings.face_recognition_model")}
            description={t("settings.face_recognition_model_help")}
            value={userSelfDetails.face_recognition_model}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, face_recognition_model: value || "HOG" });
            }}
          >
            <Group mt="xs">
              <Radio value="HOG" label={t("settings.models.hog")} />
              <Radio value="CNN" label={t("settings.models.cnn")} />
            </Group>
          </Radio.Group>
          <Radio.Group
            label={t("settings.min_cluster_size")}
            description={t("settings.min_cluster_size_help")}
            value={userSelfDetails.min_cluster_size ? userSelfDetails.min_cluster_size.toString() : "0"}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, min_cluster_size: value || 0 });
            }}
          >
            <Group mt="xs">
              <Radio value="0" label={t("settings.size.auto")} />
              <Radio value="2" label={2} />
              <Radio value="4" label={4} />
              <Radio value="8" label={8} />
              <Radio value="16" label={16} />
            </Group>
          </Radio.Group>
          <Radio.Group
            label={t("settings.min_samples")}
            description={t("settings.min_samples_help")}
            value={userSelfDetails.min_samples ? userSelfDetails.min_samples.toString() : "1"}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, min_samples: value || 0 });
            }}
          >
            <Group mt="xs">
              <Radio value="1" label={1} />
              <Radio value="2" label={2} />
              <Radio value="4" label={4} />
              <Radio value="8" label={8} />
              <Radio value="16" label={16} />
            </Group>
          </Radio.Group>
          <Radio.Group
            label={t("settings.cluster_selection_epsilon")}
            description={t("settings.cluster_selection_epsilon_help")}
            value={
              userSelfDetails.cluster_selection_epsilon ? userSelfDetails.cluster_selection_epsilon.toString() : "0.1"
            }
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, cluster_selection_epsilon: value || 0 });
            }}
          >
            <Group mt="xs">
              <Radio value="0" label={t("settings.size.off")} />
              <Radio value="0.025" label={t("settings.size.small")} />
              <Radio value="0.05" label={t("settings.size.normal")} />
              <Radio value="0.1" label={t("settings.size.high")} />
              <Radio value="0.2" label={t("settings.size.veryhigh")} />
            </Group>
          </Radio.Group>
          <NumberInput
            label={t("settings.unknown_faces_confidence")}
            description={t("settings.unknown_faces_confidence_help")}
            min={0}
            max={1.0}
            placeholder="0.50"
            precision={2}
            value={userSelfDetails.confidence_unknown_face}
            hideControls
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, confidence_unknown_face: value });
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
          <Title order={4} sx={{ marginBottom: 16 }}>
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
        <Card shadow="md">
          <Stack>
            <Title order={4} sx={{ marginBottom: 16 }}>
              <Trans i18nKey="settings.llm">Large Language Model Settings</Trans>
            </Title>
            <Switch
              label={t("settings.enablellm")}
              checked={userSelfDetails.llm_settings?.enabled}
              onChange={event => {
                setUserSelfDetails({
                  ...userSelfDetails,
                  llm_settings: {
                    ...userSelfDetails.llm_settings,
                    enabled: event.currentTarget.checked,
                  },
                });
              }}
            />
            <Switch
              label={t("settings.addperson")}
              checked={userSelfDetails.llm_settings?.add_person}
              disabled={!userSelfDetails.llm_settings?.enabled}
              onChange={event => {
                setUserSelfDetails({
                  ...userSelfDetails,
                  llm_settings: {
                    ...userSelfDetails.llm_settings,
                    add_person: event.currentTarget.checked,
                  },
                });
              }}
            />
            <Switch
              label={t("settings.addlocation")}
              checked={userSelfDetails.llm_settings?.add_location}
              disabled={!userSelfDetails.llm_settings?.enabled}
              onChange={event => {
                setUserSelfDetails({
                  ...userSelfDetails,
                  llm_settings: {
                    ...userSelfDetails.llm_settings,
                    add_location: event.currentTarget.checked,
                  },
                });
              }}
            />
          </Stack>
        </Card>
        <Space h="xl" />
      </Stack>
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
