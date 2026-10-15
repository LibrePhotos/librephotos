import { userKeys, type User } from "@librephotos/api-client";
import { Card, Container, Space, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconSettings as SettingIcon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import { useApplyDateRules } from "../../api_client/jobs/hooks";
import { useFetchUserSelfDetailsQuery, useUpdateUserMutation } from "../../api_client/user/hooks";
import { reportUserSaveError } from "../../util/apiErrors";
import { PageHeader } from "../PageHeader";
import { ApplyDateRulesOffer } from "./ApplyDateRulesOffer";
import { CaptionContextCard } from "./CaptionContextCard";
import { ConfigBurstDetection } from "./ConfigBurstDetection";
import { ConfigDateTime } from "./ConfigDateTime";
import { DuplicateDetectionCard } from "./DuplicateDetectionCard";
import { ExperimentalOptionsCard } from "./ExperimentalOptionsCard";
import { FaceOptionsCard } from "./FaceOptionsCard";
import { InterfaceCard } from "./InterfaceCard";
import { MetadataOptionsCard } from "./MetadataOptionsCard";
import { PublicSharingDefaultsCard } from "./PublicSharingDefaultsCard";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { ScanOptionsCard } from "./ScanOptionsCard";
import { SETTINGS_SECTIONS } from "./sectionIds";
import { SectionNav } from "./SectionNav";
import { SettingsSection } from "./SettingsSection";

export function Settings() {
  const [isOpenUpdateDialog, { open: openUpdateDialog, close: closeUpdateDialog }] = useDisclosure(false);
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");
  const [editedUserDetails, setEditedUserDetails] = useState(userSelfDetails);
  const { t } = useTranslation();
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const queryClient = useQueryClient();
  // Saved date rules only apply to new scans: offer to apply them to the library too (#437).
  const [dateRulesSaved, setDateRulesSaved] = useState(false);
  const applyDateRules = useApplyDateRules();

  // open update dialog, when user was edited
  useEffect(() => {
    if (userSelfDetails && editedUserDetails && JSON.stringify(userSelfDetails) !== JSON.stringify(editedUserDetails)) {
      openUpdateDialog();
    } else {
      closeUpdateDialog();
    }
  }, [userSelfDetails, editedUserDetails, openUpdateDialog, closeUpdateDialog]);

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    }
  }, [auth?.access?.user_id, queryClient]);

  useEffect(() => {
    if (userSelfDetails) {
      setEditedUserDetails(userSelfDetails);
    }
  }, [userSelfDetails]);

  if (!userSelfDetails || !editedUserDetails) {
    return null;
  }

  const edit = (patch: Partial<User>) => setEditedUserDetails({ ...editedUserDetails, ...patch });
  const cardProps = { user: editedUserDetails, onChange: edit };

  const sections = [
    { id: SETTINGS_SECTIONS.scan, label: t("settings.scanoptions") },
    { id: SETTINGS_SECTIONS.metadata, label: t("settings.metadata") },
    { id: SETTINGS_SECTIONS.faces, label: t("settings.face_options") },
    { id: SETTINGS_SECTIONS.datetime, label: t("settings.configdatetime") },
    { id: SETTINGS_SECTIONS.burst, label: t("settings.burst.title") },
    { id: SETTINGS_SECTIONS.experimental, label: t("settings.experimentaloptions") },
    { id: SETTINGS_SECTIONS.captions, label: t("settings.captioncontext") },
    { id: SETTINGS_SECTIONS.sharing, label: t("settings.publicsharingdefaults") },
    { id: SETTINGS_SECTIONS.interface, label: t("settings.interface") },
    { id: SETTINGS_SECTIONS.duplicates, label: t("settings.duplicatedetection") },
  ];

  return (
    <Container size="lg">
      <PageHeader icon={SettingIcon} title={t("settings.header")} />
      <SectionNav sections={sections}>
        <Stack>
          <SettingsSection id={SETTINGS_SECTIONS.scan}>
            <ScanOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.metadata}>
            <MetadataOptionsCard {...cardProps} saved={userSelfDetails} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.faces}>
            <FaceOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.datetime}>
            <Card shadow="md">
              <ConfigDateTime
                value={editedUserDetails.datetime_rules}
                onChange={value => edit({ datetime_rules: value || "[]" })}
                notice={
                  dateRulesSaved && (
                    <ApplyDateRulesOffer onApply={applyDateRules.start} onClose={() => setDateRulesSaved(false)} />
                  )
                }
              />
            </Card>
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.burst}>
            <Card shadow="md">
              <ConfigBurstDetection
                value={editedUserDetails.burst_detection_rules}
                onChange={value => edit({ burst_detection_rules: value })}
              />
            </Card>
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.experimental}>
            <ExperimentalOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.captions}>
            <CaptionContextCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.sharing}>
            <PublicSharingDefaultsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.interface}>
            <InterfaceCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.duplicates}>
            <DuplicateDetectionCard {...cardProps} />
          </SettingsSection>
          <Space h="xl" />
        </Stack>
      </SectionNav>
      <SaveChangesDialog
        opened={isOpenUpdateDialog}
        saving={updateUser.isPending}
        onSave={() => {
          const newUserData = { ...editedUserDetails };
          delete newUserData.scan_directory;
          delete newUserData.avatar;
          // Keep the dialog open when the server rejects the save, so the edits can be fixed.
          const rulesChanged = newUserData.datetime_rules !== userSelfDetails.datetime_rules;
          updateUser.mutate(newUserData, {
            onSuccess: () => {
              closeUpdateDialog();
              if (rulesChanged) setDateRulesSaved(true);
            },
            onError: reportUserSaveError,
          });
        }}
        onCancel={() => {
          setEditedUserDetails(userSelfDetails);
          closeUpdateDialog();
        }}
      />
    </Container>
  );
}
