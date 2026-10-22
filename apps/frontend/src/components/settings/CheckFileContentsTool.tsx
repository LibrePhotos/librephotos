import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { CHECK_FILE_CONTENTS_JOB_TYPE } from "../job/checkFileContentsResult";
import { AdminJobTool } from "./AdminJobTool";
import { CheckFileContentsModal } from "./CheckFileContentsModal";

/**
 * Admin Tools row that reads every file again to find those replaced with their old date kept
 * (#2040), the job behind `manage.py rehash_files`. Start opens the dialog that picks whose files
 * and asks first: it reads every byte and holds the job queue for as long.
 */
export function CheckFileContentsTool({ buttonWidth }: Readonly<{ buttonWidth: number }>) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <AdminJobTool
        jobType={CHECK_FILE_CONTENTS_JOB_TYPE}
        title={t("adminarea.checkfilecontents")}
        explanation={t("adminarea.checkfilecontentsexplanation")}
        buttonWidth={buttonWidth}
        isPending={false}
        onStart={open}
      />
      <CheckFileContentsModal opened={opened} onClose={close} />
    </>
  );
}
