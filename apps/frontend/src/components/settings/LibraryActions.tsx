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
import { DisabledReason } from "../common/DisabledReason";
import { ApplyDateRulesRow } from "./ApplyDateRulesRow";
import { CaptionsActions } from "./CaptionsActions";
import { ACTION_MIN_WIDTH } from "./libraryLayout";
import { ThingsActions } from "./ThingsActions";

type LibraryActionsProps = {
  /** Why job buttons are off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
  isAdmin: boolean;
  isOcrEnabled: boolean;
  /** Captions can be generated: the server has captioning on and a model picked (#2211). */
  isCaptioningAvailable: boolean;
  /** Things can be found: the server's Things switch is on (#2765). */
  isThingsAvailable: boolean;
};

/** The library jobs after a scan: event albums, faces, text recognition, captions, things and dates. */
export function LibraryActions({
  busyReason,
  isAdmin,
  isOcrEnabled,
  isCaptioningAvailable,
  isThingsAvailable,
}: LibraryActionsProps) {
  const { t } = useTranslation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const trainFaces = useTrainFacesMutation();
  const rescanFaces = useRescanFacesMutation();
  const regenerateEventTitles = useRegenerateEventTitlesMutation();
  const generateOcr = useGenerateOcrMutation();
  const ocrOff = t(isAdmin ? "settings.ocrdisabled" : "settings.ocrdisablednonadmin");
  const ocrReason = busyReason ?? (isOcrEnabled ? undefined : ocrOff);

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
          <DisabledReason reason={busyReason}>
            <Button onClick={onGenerateEventAlbumsButtonClick} leftSection={<RefreshDot />} variant="outline" fullWidth>
              {t("settings.generate")}
            </Button>
          </DisabledReason>
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
          <DisabledReason reason={busyReason}>
            <Button
              onClick={() => regenerateEventTitles.mutate()}
              leftSection={<RefreshDot />}
              variant="outline"
              fullWidth
            >
              {t("settings.regenerate")}
            </Button>
          </DisabledReason>
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
          <DisabledReason reason={busyReason}>
            <Button onClick={() => trainFaces.mutate()} leftSection={<FaceId />} variant="outline" fullWidth>
              <Trans i18nKey="settings.facesbutton" />
            </Button>
          </DisabledReason>
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
          <DisabledReason reason={busyReason}>
            <Button onClick={() => rescanFaces.mutate()} leftSection={<FaceId />} variant="outline" fullWidth>
              <Trans i18nKey="settings.rescanfaces" />
            </Button>
          </DisabledReason>
        </Grid.Col>
      </Grid>
      <Divider labelPosition="left" label={<Text fw="bold">{t("settings.textrecognition")}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.ocrtitle")}</Text>
            <Text fz="sm" c="dimmed">
              {isOcrEnabled ? t("settings.ocrdescription") : ocrOff}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Group wrap="nowrap" gap={0} justify="flex-end">
            <DisabledReason reason={ocrReason}>
              <Button
                onClick={() => generateOcr.mutate(false)}
                leftSection={<TextRecognition />}
                variant="outline"
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 0 }}
                fullWidth
              >
                {t("settings.ocrbutton")}
              </Button>
            </DisabledReason>
            <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
              {/* Outside Menu.Target, so its click handler replaces the one that opens the menu. */}
              <DisabledReason reason={ocrReason}>
                <Menu.Target>
                  <ActionIcon
                    variant="outline"
                    size={36}
                    aria-label={t("settings.ocrfullbutton")}
                    style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                  >
                    <ChevronDown size="1rem" />
                  </ActionIcon>
                </Menu.Target>
              </DisabledReason>
              <Menu.Dropdown>
                <DisabledReason reason={ocrReason} position="left">
                  <Menu.Item leftSection={<TextRecognition size="1rem" />} onClick={() => generateOcr.mutate(true)}>
                    {t("settings.ocrfullbutton")}
                  </Menu.Item>
                </DisabledReason>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Grid.Col>
      </Grid>
      {isCaptioningAvailable && <CaptionsActions busyReason={busyReason} />}
      <ThingsActions busyReason={busyReason} isAdmin={isAdmin} isThingsAvailable={isThingsAvailable} />
      <ApplyDateRulesRow busyReason={busyReason} />
    </>
  );
}
