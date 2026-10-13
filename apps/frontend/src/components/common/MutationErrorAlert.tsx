import { Alert } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/apiError";

type MutationErrorAlertProps = Readonly<{
  /** What failed, e.g. "Could not rename the album". */
  title: string;
  /** The mutation's error: its server message is shown, or a generic line. */
  error: unknown;
}>;

/**
 * A save that failed, inside the dialog that made it: the dialog stays open with what the user
 * typed, and says why (#2222). Its hook is called with `{ reportsErrors: true }`, so the
 * QueryClient does not toast the same failure as well.
 */
export function MutationErrorAlert({ title, error }: MutationErrorAlertProps) {
  const { t } = useTranslation();
  const message = (error instanceof ApiError && error.serverMessage) || t("toasts.requestfailed");
  return (
    <Alert role="alert" color="red" variant="light" icon={<IconAlertTriangle size={18} />} title={title}>
      {message}
    </Alert>
  );
}
