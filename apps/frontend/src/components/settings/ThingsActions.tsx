import { useMantineTheme } from "@mantine/core";
import { IconCategory as Category } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFindThingsMutation } from "../../api_client/jobs/hooks";
import { SplitJobSection } from "./SplitJobSection";

type ThingsActionsProps = {
  /** Why job buttons are off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
  isAdmin: boolean;
  /** Things are on: the server's Things switch (#2765). */
  isThingsAvailable: boolean;
};

/**
 * The Things section of the Library page (#2765): find the things in the photos that have none, or,
 * after a confirmation, in every photo again, once the list of things changed. While Things are
 * off the section says so and its buttons carry that reason.
 */
export function ThingsActions({ busyReason, isAdmin, isThingsAvailable }: ThingsActionsProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const findThings = useFindThingsMutation();
  const thingsOff = t(isAdmin ? "settings.thingsdisabled" : "settings.thingsdisablednonadmin");

  return (
    <SplitJobSection
      heading={t("settings.things")}
      title={t("settings.thingstitle")}
      description={isThingsAvailable ? t("settings.thingsdescription") : thingsOff}
      icon={Category}
      runLabel={t("settings.thingsbutton")}
      runAgainLabel={t("settings.thingsfullbutton")}
      confirm={{
        title: t("confirmdialog.thingsagain.title"),
        message: t("confirmdialog.thingsagain.message"),
        confirmLabel: t("confirmdialog.thingsagain.confirm"),
        // Long rather than destructive: the things are found again from the photos (#524).
        color: theme.primaryColor,
      }}
      disabledReason={busyReason ?? (isThingsAvailable ? undefined : thingsOff)}
      onRun={findThings.mutate}
      loading={findThings.isPending}
    />
  );
}
