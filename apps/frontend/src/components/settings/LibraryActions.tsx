import { ActionIcon, Button, Divider, Grid, Group, Menu, Stack, Text } from "@mantine/core";
import {
  IconChevronDown as ChevronDown,
  IconFaceId as FaceId,
  IconRefreshDot as RefreshDot,
  IconTextRecognition as TextRecognition,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useRescanFacesMutation, useTrainFacesMutation } from "../../api_client/faces";
import {
  useGenerateAutoAlbumsMutation,
  useGenerateOcrMutation,
  useRegenerateEventTitlesMutation,
} from "../../api_client/jobs/hooks";
import { ACTION_MIN_WIDTH } from "./libraryLayout";

type LibraryActionsProps = {
  workerAvailability: boolean;
  isAdmin: boolean;
  isOcrEnabled: boolean;
};

/** The library jobs after a scan: event albums, faces and text recognition. */
export function LibraryActions({ workerAvailability, isAdmin, isOcrEnabled }: LibraryActionsProps) {
  const { t } = useTranslation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const trainFaces = useTrainFacesMutation();
  const rescanFaces = useRescanFacesMutation();
  const regenerateEventTitles = useRegenerateEventTitlesMutation();
  const generateOcr = useGenerateOcrMutation();

  const onGenerateEventAlbumsButtonClick = () => {
    generateAutoAlbums();
  };

  return (
    <>
      <Divider labelPosition="left" label={<Text fw="bold">{t("settings.eventsalbums")}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.eventalbumsgenerate")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.eventsalbumsdescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Button
            onClick={onGenerateEventAlbumsButtonClick}
            disabled={!workerAvailability}
            leftSection={<RefreshDot />}
            variant="outline"
            fullWidth
          >
            {t("settings.generate")}
          </Button>
        </Grid.Col>
      </Grid>

      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.eventalbumsregenerate")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.eventalbumsregeneratedescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Button
            onClick={() => regenerateEventTitles.mutate()}
            disabled={!workerAvailability}
            leftSection={<RefreshDot />}
            variant="outline"
            fullWidth
          >
            {t("settings.regenerate")}
          </Button>
        </Grid.Col>
      </Grid>
      <Divider
        labelPosition="left"
        label={
          <Text fw="bold">
            {t("settings.faces")} & {t("settings.people")}
          </Text>
        }
        mt={20}
      />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.trainfacestitle")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.trainfacesdescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Button
            disabled={!workerAvailability}
            onClick={() => trainFaces.mutate()}
            leftSection={<FaceId />}
            variant="outline"
            fullWidth
          >
            <Trans i18nKey="settings.facesbutton" />
          </Button>
        </Grid.Col>
      </Grid>
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.rescanfacestitle")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.rescanfacesdescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Button
            disabled={!workerAvailability}
            onClick={() => rescanFaces.mutate()}
            leftSection={<FaceId />}
            variant="outline"
            fullWidth
          >
            <Trans i18nKey="settings.rescanfaces" />
          </Button>
        </Grid.Col>
      </Grid>
      <Divider labelPosition="left" label={<Text fw="bold">{t("settings.textrecognition")}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.ocrtitle")}</Text>
            <Text fz="sm" c="dimmed">
              {isOcrEnabled
                ? t("settings.ocrdescription")
                : t(isAdmin ? "settings.ocrdisabled" : "settings.ocrdisablednonadmin")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Group wrap="nowrap" gap={0} justify="flex-end">
            <Button
              disabled={!workerAvailability || !isOcrEnabled}
              onClick={() => generateOcr.mutate(false)}
              leftSection={<TextRecognition />}
              variant="outline"
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 0 }}
              fullWidth
            >
              {t("settings.ocrbutton")}
            </Button>
            <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="outline"
                  size={36}
                  disabled={!workerAvailability || !isOcrEnabled}
                  aria-label={t("settings.ocrfullbutton")}
                  style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                >
                  <ChevronDown size="1rem" />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<TextRecognition size="1rem" />}
                  onClick={() => generateOcr.mutate(true)}
                  disabled={!workerAvailability || !isOcrEnabled}
                >
                  {t("settings.ocrfullbutton")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Grid.Col>
      </Grid>
    </>
  );
}
