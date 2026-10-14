import { Button, Divider, Grid, Stack, Text } from "@mantine/core";
import { IconCalendarRepeat as CalendarRepeat } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useApplyDateRules } from "../../api_client/jobs/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { ACTION_MIN_WIDTH } from "./libraryLayout";

type ApplyDateRulesRowProps = Readonly<{
  /** Why the button is off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
}>;

/** The Library page's Dates section: apply the current date rules to the photos already scanned (#437). */
export function ApplyDateRulesRow({ busyReason }: ApplyDateRulesRowProps) {
  const { t } = useTranslation();
  const { start, running } = useApplyDateRules();

  return (
    <>
      <Divider labelPosition="left" label={<Text fw="bold">{t("settings.dates")}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{t("settings.reapplydaterulestitle")}</Text>
            <Text fz="sm" c="dimmed">
              {t("settings.reapplydaterulesdescription")}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <DisabledReason reason={busyReason}>
            <Button onClick={start} loading={running} leftSection={<CalendarRepeat />} variant="outline" fullWidth>
              {t("settings.reapplydaterulesbutton")}
            </Button>
          </DisabledReason>
        </Grid.Col>
      </Grid>
    </>
  );
}
