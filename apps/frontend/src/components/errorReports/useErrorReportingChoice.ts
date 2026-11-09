import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useErrorReportsQuery, useSendAllErrorReportsMutation } from "../../api_client/errorReports";
import { useSaveSiteSettings } from "../settings/useSaveSiteSettings";
import type { ErrorReportingMode, SendingMode } from "./errorReportingMode";
import { useSendAllToast } from "./useSendAllToast";

/**
 * Choosing where error reports go (#2938), the same in the Admin card, the first-time setup and the
 * one-time question: turning sharing on while reports are saved first asks, in
 * ErrorReportingOptInModal (spread `optIn` on it), whether they go too. `onSaved` runs once the
 * choice is saved; Cancel in that dialog saves nothing. `enabled: false` (an older backend) reads
 * no saved reports.
 */
export function useErrorReportingChoice({
  current,
  onSaved,
  enabled = true,
}: Readonly<{ current: ErrorReportingMode; onSaved?: () => void; enabled?: boolean }>) {
  const { data: reports = [] } = useErrorReportsQuery({ enabled });
  const save = useSaveSiteSettings();
  const sendAll = useSendAllErrorReportsMutation();
  const sendAllToast = useSendAllToast();
  const [pending, setPending] = useState<SendingMode | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const unsent = reports.filter(report => report.sent_at === null);

  const choose = (next: ErrorReportingMode) => {
    if (next === "off" || current !== "off" || unsent.length === 0) {
      save({ error_reporting: next }, onSaved);
      return;
    }
    setPending(next);
    open();
  };
  const answer = (sendSaved: boolean) => {
    if (pending !== null) {
      save({ error_reporting: pending }, () => {
        if (sendSaved) sendAll.mutate(undefined, sendAllToast);
        onSaved?.();
      });
    }
    close();
  };

  return {
    choose,
    unsent,
    optIn: { opened, onClose: close, destination: pending ?? "maintainers", reports: unsent, onChoose: answer },
  };
}
