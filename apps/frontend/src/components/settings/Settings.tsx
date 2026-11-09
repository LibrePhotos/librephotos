import { userKeys, type User } from "@librephotos/api-client";
import { Stack } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import { useApplyDateRules } from "../../api_client/jobs/hooks";
import { useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { PageHeader } from "../PageHeader";
import { SettingsPageFrame } from "../SettingsPageFrame";
import { ApplyDateRulesOffer } from "./ApplyDateRulesOffer";
import { CaptionContextCard } from "./CaptionContextCard";
import { ConfigBurstDetection } from "./ConfigBurstDetection";
import { ConfigDateTime } from "./ConfigDateTime";
import { DuplicateDetectionCard } from "./DuplicateDetectionCard";
import { ExperimentalOptionsCard } from "./ExperimentalOptionsCard";
import { FaceOptionsCard } from "./FaceOptionsCard";
import { InterfaceCard } from "./InterfaceCard";
import { MetadataOptionsCard } from "./MetadataOptionsCard";
import { PublicGalleryCard } from "./PublicGalleryCard";
import { PublicSharingDefaultsCard } from "./PublicSharingDefaultsCard";
import { RightsDefaultCard } from "./RightsDefaultCard";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { ScanOptionsCard } from "./ScanOptionsCard";
import { SETTINGS_SECTIONS } from "./sectionIds";
import { SectionNav } from "./SectionNav";
import { SettingsCard } from "./SettingsCard";
import { SettingsSection } from "./SettingsSection";
import { UserSharingCard } from "./UserSharingCard";
import { useUserSettingsDraft } from "./useUserSettingsDraft";

export function Settings() {
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");
  const draft = useUserSettingsDraft(userSelfDetails);
  const editedUserDetails = draft.user;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Saved date rules only apply to new scans: offer to apply them to the library too (#437).
  const [dateRulesSaved, setDateRulesSaved] = useState(false);
  const applyDateRules = useApplyDateRules();

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    }
  }, [auth?.access?.user_id, queryClient]);

  if (!userSelfDetails || !editedUserDetails) {
    return null;
  }

  const edit = (patch: Partial<User>) => draft.edit(user => ({ ...user, ...patch }));
  const cardProps = { user: editedUserDetails, onChange: edit };

  const sections = [
    { id: SETTINGS_SECTIONS.scan, label: t("settings.scanoptions") },
    { id: SETTINGS_SECTIONS.metadata, label: t("settings.metadata") },
    { id: SETTINGS_SECTIONS.faces, label: t("settings.face_options") },
    { id: SETTINGS_SECTIONS.datetime, label: t("settings.configdatetime") },
    { id: SETTINGS_SECTIONS.burst, label: t("settings.burst.title") },
    { id: SETTINGS_SECTIONS.experimental, label: t("settings.experimentaloptions") },
    { id: SETTINGS_SECTIONS.captions, label: t("settings.captioncontext") },
    { id: SETTINGS_SECTIONS.sharing, label: t("sidemenu.sharing") },
    { id: SETTINGS_SECTIONS.interface, label: t("settings.interface") },
    { id: SETTINGS_SECTIONS.duplicates, label: t("settings.duplicatedetection") },
  ];

  return (
    <SettingsPageFrame withSectionNav header={<PageHeader title={t("settings.header")} />}>
      <SectionNav sections={sections}>
        <Stack>
          <SettingsSection id={SETTINGS_SECTIONS.scan}>
            <ScanOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.metadata}>
            <MetadataOptionsCard {...cardProps} saved={userSelfDetails} />
            <RightsDefaultCard {...cardProps} saved={userSelfDetails} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.faces}>
            <FaceOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.datetime}>
            <SettingsCard>
              <ConfigDateTime
                value={editedUserDetails.datetime_rules}
                onChange={value => edit({ datetime_rules: value || "[]" })}
                notice={
                  dateRulesSaved && (
                    <ApplyDateRulesOffer onApply={applyDateRules.start} onClose={() => setDateRulesSaved(false)} />
                  )
                }
              />
            </SettingsCard>
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.burst}>
            <SettingsCard>
              <ConfigBurstDetection
                value={editedUserDetails.burst_detection_rules}
                onChange={value => edit({ burst_detection_rules: value })}
              />
            </SettingsCard>
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.experimental}>
            <ExperimentalOptionsCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.captions}>
            <CaptionContextCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.sharing}>
            <UserSharingCard {...cardProps} />
            <PublicSharingDefaultsCard {...cardProps} />
            <PublicGalleryCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.interface}>
            <InterfaceCard {...cardProps} />
          </SettingsSection>
          <SettingsSection id={SETTINGS_SECTIONS.duplicates}>
            <DuplicateDetectionCard {...cardProps} />
          </SettingsSection>
        </Stack>
      </SectionNav>
      {/* A refused save keeps the edits and the prompt, so the edits can be fixed. */}
      <SaveChangesDialog
        opened={draft.pending}
        saving={draft.saving}
        onSave={() => {
          const rulesChanged = editedUserDetails.datetime_rules !== userSelfDetails.datetime_rules;
          void draft.save().then(saved => {
            if (saved && rulesChanged) setDateRulesSaved(true);
          });
        }}
        onCancel={draft.discard}
      />
    </SettingsPageFrame>
  );
}
