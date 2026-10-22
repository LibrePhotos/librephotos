import { Space, Text, Title } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { DirectoryPicker } from "../setup/DirectoryPicker";
import { uploadLocation } from "../setup/uploadLocation";
import type { UserEditValues } from "./ModalUserEdit.schema";
import { ScanDirectoryChangeNotice } from "./ScanDirectoryChangeNotice";
import classes from "./UserFoldersSection.module.css";
import type { ScanDirectoryChange } from "./useScanDirectoryChange";

type Props = Readonly<{
  form: UseFormReturnType<UserEditValues>;
  firstTimeSetup: boolean;
  /** The upload folder only matters while uploads are allowed on this server. */
  uploadsAllowed: boolean;
  scanDirectoryPlaceholder: string;
  isPathValid: boolean;
  isUploadPathValid: boolean;
  onPathValidity: (valid: boolean) => void;
  onUploadPathValidity: (valid: boolean) => void;
  change: ScanDirectoryChange;
}>;

/** The user dialog's library folders: the scan directory, what a change does (#2036), the upload folder. */
export function UserFoldersSection(props: Props) {
  const { form, firstTimeSetup, uploadsAllowed, scanDirectoryPlaceholder, change } = props;
  const { t } = useTranslation();
  const username = form.values.username || "…";
  // Null without a scan directory: the backend refuses uploads then.
  const webUploadLocation = uploadLocation(form.values.scan_directory, form.values.upload_directory);
  const showLocation = props.isPathValid && props.isUploadPathValid && webUploadLocation;

  return (
    <>
      <Title order={5}>{t("modalscandirectoryedit.header")} </Title>
      <Text size="sm" c="dimmed">
        {t("modalscandirectoryedit.explanation1")} &quot;{username}&quot; {t("modalscandirectoryedit.explanation2")}
      </Text>
      <Space h="md" />
      <DirectoryPicker
        value={form.values.scan_directory}
        onChange={next => form.setFieldValue("scan_directory", next)}
        onValidityChange={props.onPathValidity}
        required={firstTimeSetup}
        placeholder={scanDirectoryPlaceholder}
        label={
          <Text fw="bold" span>
            {t("modalscandirectoryedit.currentdirectory")}
          </Text>
        }
        description={
          <Text size="sm" c="dimmed" mt="xs">
            {t("modalscandirectoryedit.explanation3")}
          </Text>
        }
        missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
      />
      {change.changed && !change.countFailed && (
        <ScanDirectoryChangeNotice
          username={username}
          outsideCount={change.outsideCount}
          choice={form.values.photos_outside}
          onChoiceChange={choice => form.setFieldValue("photos_outside", choice)}
        />
      )}
      {uploadsAllowed && (
        <>
          <Space h="md" />
          <DirectoryPicker
            name="upload_directory"
            value={form.values.upload_directory}
            onChange={next => form.setFieldValue("upload_directory", next)}
            onValidityChange={props.onUploadPathValidity}
            placeholder={t("modalscandirectoryedit.uploadfolderdefault")}
            label={
              <Text fw="bold" span>
                {t("modalscandirectoryedit.uploadfolder")}
              </Text>
            }
            // Under the upload folder input, the one that changes it, rather than
            // two fields up; a missing folder would make the announced location wrong.
            hint={
              showLocation ? (
                <Text size="sm" c="dimmed" mt={4} className={classes.location}>
                  {t("modalscandirectoryedit.uploadlocation", { path: webUploadLocation })}
                </Text>
              ) : undefined
            }
            description={
              <Text size="sm" c="dimmed" mt="xs">
                {t("modalscandirectoryedit.uploadfolderexplanation")}
              </Text>
            }
            missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
          />
        </>
      )}
    </>
  );
}
