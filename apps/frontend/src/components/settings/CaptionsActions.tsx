import { ActionIcon, Button, Divider, Grid, Group, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown as ChevronDown, IconTextCaption as TextCaption } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGenerateCaptionsMutation } from "../../api_client/jobs/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import classes from "./CaptionsActions.module.css";
import { ACTION_MIN_WIDTH } from "./libraryLayout";

type CaptionsActionsProps = {
  /** Why job buttons are off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
};

/**
 * The Captions section of the Library page (#2211): caption the photos that have no generated
 * caption, or, after a confirmation, every photo again. Shown only while captioning is on.
 */
export function CaptionsActions({ busyReason }: CaptionsActionsProps) {
  const { t } = useTranslation();
  const generateCaptions = useGenerateCaptionsMutation();
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  return (
    <>
      <Divider labelPosition="left" label={<Text fw="bold">{t("settings.captions")}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.captionstitle")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.captionsdescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Group wrap="nowrap" gap={0} justify="flex-end">
            <DisabledReason reason={busyReason}>
              <Button
                onClick={() => generateCaptions.mutate(false)}
                leftSection={<TextCaption />}
                variant="outline"
                className={classes.main}
                fullWidth
              >
                {t("settings.captionsbutton")}
              </Button>
            </DisabledReason>
            <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
              {/* Outside Menu.Target, so its click handler replaces the one that opens the menu. */}
              <DisabledReason reason={busyReason}>
                <Menu.Target>
                  <ActionIcon
                    variant="outline"
                    size={36}
                    aria-label={t("settings.captionsfullbutton")}
                    className={classes.toggle}
                  >
                    <ChevronDown size="1rem" />
                  </ActionIcon>
                </Menu.Target>
              </DisabledReason>
              <Menu.Dropdown>
                <Menu.Item leftSection={<TextCaption size="1rem" />} onClick={openConfirm}>
                  {t("settings.captionsfullbutton")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Grid.Col>
      </Grid>
      {/* Next to the Menu, not in it: the dropdown unmounts when the item closes it. */}
      <ConfirmModal
        opened={confirmOpened}
        onClose={closeConfirm}
        onConfirm={() => generateCaptions.mutate(true, { onSettled: closeConfirm })}
        loading={generateCaptions.isPending}
        title={t("confirmdialog.captionsagain.title")}
        message={t("confirmdialog.captionsagain.message")}
        confirmLabel={t("confirmdialog.captionsagain.confirm")}
      />
    </>
  );
}
