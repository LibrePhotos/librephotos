import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLookUpPlacesMutation } from "../../api_client/jobs/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { AdminJobTool } from "./AdminJobTool";

// LongRunningJob.JOB_LOOK_UP_PLACES in the backend.
const LOOK_UP_PLACES_JOB_TYPE = 29;

/**
 * Admin Tools row that looks the place names of every photo up again with the Map Provider set
 * now (#2302): switching the provider renames nothing by itself. It asks first, because it
 * renames the Places albums of every user and can take hours with an online provider.
 */
export function LookUpPlacesTool({ buttonWidth }: Readonly<{ buttonWidth: number }>) {
  const { t } = useTranslation();
  const { mutate: start, isPending } = useLookUpPlacesMutation();
  const [confirmOpen, { open, close }] = useDisclosure(false);

  return (
    <>
      <AdminJobTool
        jobType={LOOK_UP_PLACES_JOB_TYPE}
        title={t("adminarea.lookupplaces")}
        explanation={t("adminarea.lookupplacesexplanation")}
        buttonWidth={buttonWidth}
        isPending={isPending}
        onStart={open}
      />
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={() => start(undefined, { onSettled: close })}
        title={t("adminarea.lookupplacesconfirmtitle")}
        message={t("adminarea.lookupplacesconfirm")}
        confirmLabel={t("adminarea.lookupplacesconfirmbutton")}
        loading={isPending}
      />
    </>
  );
}
