import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconCalendarRepeat as CalendarRepeat } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useJobQueue } from "../../hooks/useJobQueue";
import { DisabledReason } from "../common/DisabledReason";

type ApplyDateRulesOfferProps = Readonly<{
  /** Starts Apply date rules to existing photos; the offer closes. */
  onApply: () => void;
  onClose: () => void;
}>;

/**
 * Shown on the date rules card once changed rules were saved (#437): new scans use them, and this
 * offers to apply them to the photos already in the library, the Library page's Dates row. A hint,
 * not a prompt: nothing runs until it is clicked, and it can be closed.
 */
export function ApplyDateRulesOffer({ onApply, onClose }: ApplyDateRulesOfferProps) {
  const { t } = useTranslation();
  const queue = useJobQueue();
  const busyReason = queue.busy ? t("jobs.queuebusy.reason") : undefined;

  return (
    <Alert
      role="status"
      color="blue"
      icon={<CalendarRepeat />}
      title={t("settings.daterulesoffertitle")}
      withCloseButton
      closeButtonLabel={t("settings.daterulesofferdismiss")}
      onClose={onClose}
      mb="md"
    >
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{t("settings.daterulesoffer")}</Text>
        <Group>
          <DisabledReason reason={busyReason}>
            <Button
              size="xs"
              onClick={() => {
                onApply();
                onClose();
              }}
            >
              {t("settings.daterulesofferbutton")}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </Alert>
  );
}
