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
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import { useFetchTimezonesQuery } from "../../api_client/settings";
import {
  useFetchUserSelfDetailsQuery,
  UserSelfDetailsQueryKeys,
  useUpdateUserMutation,
} from "../../api_client/user/hooks";
import { ConfigBurstDetection } from "./ConfigBurstDetection";
import { ConfigDateTime } from "./ConfigDateTime";

export function Settings() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");
  const [editedUserDetails, setEditedUserDetails] = useState(userSelfDetails);
  const { t } = useTranslation();
  const { data: timezoneList = [] } = useFetchTimezonesQuery();
  const updateUser = useUpdateUserMutation();
  const queryClient = useQueryClient();

  // open update dialog, when user was edited
  useEffect(() => {
    if (userSelfDetails && editedUserDetails && JSON.stringify(userSelfDetails) !== JSON.stringify(editedUserDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetails, editedUserDetails]);

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
    }
  }, [auth?.access?.user_id, queryClient]);

  useEffect(() => {
    if (userSelfDetails) {
      setEditedUserDetails(userSelfDetails);
    }
  }, [userSelfDetails]);

  if (!userSelfDetails || !editedUserDetails) {
    return null;
  }

  return (
    <Container>
      <Group gap="xs" mt={40} mb={20}>
        <SettingIcon size={35} />
        <Title order={1}>{t("settings.header")}</Title>
      </Group>
      <Stack>
        <Card shadow="md">
          <Title order={4} mb={16}>
            <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Radio.Group
              description={t("settings.confidencelevel")}
              label={t("settings.sceneconfidence")}
              value={editedUserDetails.confidence?.toString() || "0"}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, confidence: parseFloat(value) || 0 });
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
              value={editedUserDetails.semantic_search_topk?.toString()}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, semantic_search_topk: parseInt(value, 10) || 0 });
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
          <Title order={4} mb={16}>
            <Trans i18nKey="settings.metadata">Metadata</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Radio.Group
              label={t("settings.sync")}
              value={editedUserDetails.save_metadata_to_disk}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, save_metadata_to_disk: value || "OFF" });
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
              value={editedUserDetails.favorite_min_rating?.toString()}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, favorite_min_rating: parseInt(value, 10) || 3 });
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
              value={editedUserDetails.default_timezone}
              placeholder={t("defaulttimezone")}
              searchable
              title={t("timezoneexplain")}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, default_timezone: value ?? "UTC" });
              }}
              data={timezoneList}
            />
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} mb={16}>
            {t("settings.albumoptions")}
          </Title>
          <NumberInput
            label={t("settings.inferredfacesconfidence")}
            description={t("settings.inferredfacesconfidencehelp")}
            min={0}
            max={1.0}
            placeholder="0.90"
            decimalScale={2}
            value={typeof editedUserDetails.confidence_person === "number" ? editedUserDetails.confidence_person : 0}
            hideControls
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, confidence_person: typeof value === "number" ? value : 0 });
            }}
          />
        </Card>
        <Card shadow="md">
          <Title order={4} mb={16}>
            {t("settings.face_options")}
          </Title>
          <Radio.Group
            label={t("settings.face_recognition_model")}
            description={t("settings.face_recognition_model_help")}
            value={editedUserDetails.face_recognition_model}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, face_recognition_model: value || "HOG" });
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
            value={editedUserDetails.min_cluster_size ? editedUserDetails.min_cluster_size.toString() : "0"}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, min_cluster_size: parseInt(value, 10) || 0 });
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
            value={editedUserDetails.min_samples ? editedUserDetails.min_samples.toString() : "1"}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, min_samples: parseInt(value, 10) || 0 });
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
              editedUserDetails.cluster_selection_epsilon
                ? editedUserDetails.cluster_selection_epsilon.toString()
                : "0.1"
            }
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, cluster_selection_epsilon: parseFloat(value) || 0 });
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
            decimalScale={2}
            value={
              typeof editedUserDetails.confidence_unknown_face === "number"
                ? editedUserDetails.confidence_unknown_face
                : 0
            }
            hideControls
            onChange={value => {
              setEditedUserDetails({
                ...editedUserDetails,
                confidence_unknown_face: typeof value === "number" ? value : 0,
              });
            }}
          />
        </Card>
        <Card shadow="md">
          <ConfigDateTime
            value={editedUserDetails.datetime_rules}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, datetime_rules: value || "[]" });
            }}
          />
        </Card>
        <Card shadow="md">
          <ConfigBurstDetection
            value={editedUserDetails.burst_detection_rules}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, burst_detection_rules: value });
            }}
          />
        </Card>
        <Card shadow="md">
          <Title order={4} mb={16}>
            <Trans i18nKey="settings.experimentaloptions">Experimental options</Trans>
          </Title>
          <Switch
            label={t("settings.transcodevideo")}
            checked={editedUserDetails.transcode_videos}
            onChange={event => {
              setEditedUserDetails({
                ...editedUserDetails,
                transcode_videos: event.currentTarget.checked,
              });
            }}
          />
        </Card>
        <Card shadow="md">
          <Stack>
            <Title order={4} mb={16}>
              <Trans i18nKey="settings.llm">Large Language Model Settings</Trans>
            </Title>
            <Switch
              label={t("settings.enablellm")}
              checked={editedUserDetails.llm_settings?.enabled}
              onChange={event => {
                setEditedUserDetails({
                  ...editedUserDetails,
                  llm_settings: {
                    ...editedUserDetails.llm_settings,
                    enabled: event.currentTarget.checked,
                  },
                });
              }}
            />
            <Switch
              label={t("settings.addperson")}
              checked={editedUserDetails.llm_settings?.add_person}
              disabled={!editedUserDetails.llm_settings?.enabled}
              onChange={event => {
                setEditedUserDetails({
                  ...editedUserDetails,
                  llm_settings: {
                    ...editedUserDetails.llm_settings,
                    add_person: event.currentTarget.checked,
                  },
                });
              }}
            />
            <Switch
              label={t("settings.addlocation")}
              checked={editedUserDetails.llm_settings?.add_location}
              disabled={!editedUserDetails.llm_settings?.enabled}
              onChange={event => {
                setEditedUserDetails({
                  ...editedUserDetails,
                  llm_settings: {
                    ...editedUserDetails.llm_settings,
                    add_location: event.currentTarget.checked,
                  },
                });
              }}
            />
          </Stack>
        </Card>
        <Card shadow="md">
          <Title order={4} mb={16}>
            <Trans i18nKey="settings.interface">Interface</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Select
              label={t("settings.slideshowinterval")}
              description={t("settings.slideshowintervaldesc")}
              value={(editedUserDetails.slideshow_interval ?? 5).toString()}
              onChange={value => {
                setEditedUserDetails({
                  ...editedUserDetails,
                  slideshow_interval: parseInt(value || "5", 10),
                });
              }}
              data={[
                { value: "3", label: "3 seconds" },
                { value: "5", label: "5 seconds" },
                { value: "10", label: "10 seconds" },
                { value: "15", label: "15 seconds" },
                { value: "30", label: "30 seconds" },
              ]}
            />
          </Flex>
        </Card>
        <Card shadow="md">
          <Title order={4} mb={16}>
            <Trans i18nKey="settings.duplicatedetection">Duplicate Detection</Trans>
          </Title>
          <Flex align="flex-start" direction="column" gap="md">
            <Radio.Group
              label={t("settings.duplicatesensitivity")}
              description={t("settings.duplicatesensitivityhelp")}
              value={editedUserDetails.duplicate_sensitivity || "normal"}
              onChange={value => {
                setEditedUserDetails({ ...editedUserDetails, duplicate_sensitivity: value || "normal" });
              }}
            >
              <Group mt="xs">
                <Radio value="strict" label={t("settings.sensitivity.strict")} />
                <Radio value="normal" label={t("settings.sensitivity.normal")} />
                <Radio value="loose" label={t("settings.sensitivity.loose")} />
              </Group>
            </Radio.Group>
            <Switch
              label={t("settings.duplicateclearexisting")}
              description={t("settings.duplicateclearexistinghelp")}
              checked={editedUserDetails.duplicate_clear_existing || false}
              onChange={event => {
                setEditedUserDetails({
                  ...editedUserDetails,
                  duplicate_clear_existing: event.currentTarget.checked,
                });
              }}
            />
          </Flex>
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
        <Text size="sm" style={{ marginBottom: 10 }} fw={500}>
          {t("settings.savechanges")}
        </Text>

        <Group justify="flex-end">
          <Button
            size="sm"
            color="green"
            onClick={() => {
              if (editedUserDetails) {
                const newUserData = { ...editedUserDetails };
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser.mutate(newUserData);
                setIsOpenUpdateDialog(false);
              }
            }}
          >
            <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
          </Button>
          <Button
            onClick={() => {
              setEditedUserDetails(userSelfDetails);
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
