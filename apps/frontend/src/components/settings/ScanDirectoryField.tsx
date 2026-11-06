import { ActionIcon, CopyButton, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./ScanDirectoryField.module.css";

type Props = Readonly<{
  /** The admin's scan directory, as the server stores it. */
  path: string;
}>;

/**
 * The scan directory on the Profile page: read-only (it is changed in the Admin area's user list),
 * a long path ends in an ellipsis with the whole path in a tooltip, and a button copies it.
 */
export function ScanDirectoryField({ path }: Props): React.JSX.Element {
  const { t } = useTranslation();
  // No clipboard on plain HTTP: no button that cannot work.
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  return (
    <Tooltip label={path} disabled={!path} multiline maw={480} openDelay={400} position="top-start">
      <TextInput
        label={t("settings.scandirectory")}
        description={t("settings.scandirectoryreadonly")}
        // Filled, so it does not pass for one of the editable fields around it.
        variant="filled"
        readOnly
        value={path}
        classNames={{ input: classes.input }}
        rightSection={
          canCopy && path ? (
            <CopyButton value={path}>
              {({ copied, copy }) => (
                <ActionIcon
                  variant="subtle"
                  color={copied ? "teal" : "gray"}
                  aria-label={copied ? t("settings.scandirectorycopied") : t("settings.copyscandirectory")}
                  onClick={copy}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          ) : undefined
        }
      />
    </Tooltip>
  );
}
